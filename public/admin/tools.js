// Organizer tools for the template: quick event wizard, statistics, home banners, About page editor,
// organizer-entered registrations. All writes go through /api/admin/* where the server checks permissions again.
import {api,esc,dateLabel,toast} from '../shared.js';

const localValue=v=>v?new Date(new Date(v).getTime()+8*3600000).toISOString().slice(0,16):'';
const utcValue=v=>v?new Date(v+':00+08:00').toISOString():null;
const sel=(a,b)=>a===b?'selected':'';

// ---------- Fee + seat limit fields shared by the wizard and the session editor ----------
export function feeFields(s={}){
 const type=s.fee_type||(s.fee==='免費'?'free':s.fee&&s.fee!=='待定'?'paid':'tbd');
 return `<div class="form-field"><label for="fee-type">收費方式</label><select id="fee-type" name="fee_type"><option value="free" ${sel(type,'free')}>免費</option><option value="paid" ${sel(type,'paid')}>收費</option><option value="tbd" ${sel(type,'tbd')}>待定（不可開放報名）</option></select></div>
 <div class="form-field fee-paid-only"><label for="fee-amount">每人金額（元）</label><input id="fee-amount" type="number" name="fee_amount" min="0" max="1000000" step="1" inputmode="numeric" value="${s.fee_amount??''}"></div>
 <div class="form-field wide fee-note-field"><label for="fee-note">收費說明（選填）</label><input id="fee-note" name="fee_note" maxlength="200" value="${esc(s.fee_note||'')}" placeholder="例如：現場收現金、含材料費"></div>
 <div class="form-field"><label for="max-seats">每筆報名最多幾人</label><input id="max-seats" type="number" name="max_seats_per_registration" min="1" max="100000" step="1" value="${s.max_seats_per_registration??10}" required><p class="help">居民一次最多可替幾位報名；總名額另外計算。</p></div>`;
}
export function bindFeeFields(form){
 const sync=()=>{const paid=form.fee_type.value==='paid';for(const el of form.querySelectorAll('.fee-paid-only'))el.hidden=!paid;form.fee_amount.required=paid;form.querySelector('.fee-note-field').hidden=form.fee_type.value==='tbd';};
 form.fee_type.addEventListener('change',sync);sync();
}
export const feeBody=f=>({fee_type:f.fee_type.value,fee_amount:f.fee_type.value==='paid'?Number(f.fee_amount.value):null,fee_note:f.fee_note.value,max_seats_per_registration:Number(f.max_seats_per_registration.value)});

// ---------- Quick event wizard ----------
export function quickEventWizard(ctx){
 ctx.openEditor('新增活動',`<form id="quick-form" class="wizard">
 <fieldset><legend>1. 活動資料</legend><div class="form-grid">
  <div class="form-field wide"><label for="q-title">活動名稱</label><input id="q-title" name="title" maxlength="200" required></div>
  <div class="form-field wide"><label for="q-desc">活動說明</label><textarea id="q-desc" name="description" rows="4"></textarea></div>
  <div class="form-field wide"><label for="q-notes">注意事項（選填）</label><textarea id="q-notes" name="notes" rows="2"></textarea></div>
  <div class="form-field wide"><label for="q-contact">主辦方聯絡方式</label><input id="q-contact" name="contact" maxlength="500" required placeholder="Email、電話或 LINE 官方帳號"></div>
  <div class="form-field wide"><label for="q-cover">活動封面（選填，JPG／PNG／WebP）</label><input id="q-cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp"><p class="help">建議 1600×900（16:9）。封面依原比例完整顯示，含文字的海報不會被裁切。</p></div>
 </div></fieldset>
 <fieldset><legend>2. 第一個場次</legend><div class="form-grid">
  <div class="form-field"><label for="q-start">開始時間（台灣）</label><input id="q-start" type="datetime-local" name="starts" required></div>
  <div class="form-field"><label for="q-end">結束時間（台灣）</label><input id="q-end" type="datetime-local" name="ends" required></div>
  <div class="form-field wide"><label for="q-loc">地點</label><input id="q-loc" name="location" maxlength="300" required></div>
  <div class="form-field"><label for="q-cap">總名額（人）</label><input id="q-cap" type="number" name="capacity" min="1" max="100000" step="1" value="30" required></div>
  ${feeFields({fee_type:'free'})}
 </div></fieldset>
 <fieldset><legend>3. 報名表</legend>
  <p class="help">使用標準報名表：姓名、電子郵件、聯絡電話（選填）、參加人數。建立後仍可在「報名表版本」新增自訂欄位。</p>
  <label class="choice"><input type="checkbox" name="open" checked>建立後立即開放報名（需已在「營運設定」完成個資告知）</label>
 </fieldset>
 <p class="error" id="edit-error" role="alert"></p><div class="editor-actions"><button class="button">建立活動</button></div></form>`);
 const form=document.querySelector('#quick-form');bindFeeFields(form);
 form.onsubmit=async ev=>{ev.preventDefault();const f=ev.target,button=f.querySelector('.editor-actions button');
  await ctx.busy(button,async()=>{try{
   const out=await api('/api/admin/events/quick',{method:'POST',body:{title:f.title.value,description:f.description.value,notes:f.notes.value,contact:f.contact.value,open:f.open.checked,session:{starts_at:utcValue(f.starts.value),ends_at:utcValue(f.ends.value),location:f.location.value,capacity:Number(f.capacity.value),...feeBody(f)}}});
   const file=f.cover.files[0];
   if(file){try{await uploadCover(out.id,file);}catch(e){toast(`活動已建立，但封面上傳失敗：${e.message}`);}}
   ctx.dialog.close();toast(f.open.checked?'活動已建立並開放報名':'活動已建立（草稿），可稍後發布');await ctx.reload();
  }catch(e){f.querySelector('#edit-error').textContent=e.message;}});};
}
async function uploadCover(eventId,file){
 const photo=await api(`/api/admin/photos?event_id=${encodeURIComponent(eventId)}`,{method:'POST',body:file,headers:{'Content-Type':file.type}});
 const thumb=await makeThumbnail(file);await api(`/api/admin/photos/${photo.id}/thumbnail`,{method:'POST',body:thumb,headers:{'Content-Type':thumb.type}});
 await api(`/api/admin/photos/${photo.id}`,{method:'PATCH',body:{status:'published',cover:'event',caption:'活動封面'}});
}
async function makeThumbnail(file){const bitmap=await createImageBitmap(file);const scale=Math.min(1,800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('無法產生縮圖')),'image/webp',.82));}

// ---------- Hide / duplicate / delete / restore ----------
export async function eventAction(ctx,e,action){
 if(action==='hide'||action==='unhide'){const hidden=action==='hide';
  if(!await ctx.confirmAction({title:hidden?'隱藏這個活動？':'取消隱藏？',action:hidden?'隱藏活動':'重新顯示',body:hidden?'<p>活動會從居民網站與報名頁消失，<strong>已報名者的資料與通知不受影響</strong>。這不是取消活動；若活動不辦了，請改用「活動狀態：已取消」。</p>':'<p>活動會重新出現在居民網站（仍須為已發布狀態）。</p>'}))return;
  await api(`/api/admin/events/${e.id}/hide`,{method:'POST',body:{hidden}});toast(hidden?'活動已隱藏':'活動已重新顯示');return ctx.reload();}
 if(action==='duplicate'){const out=await api(`/api/admin/events/${e.id}/duplicate`,{method:'POST',body:{}});toast('已複製為草稿，請設定新場次');await ctx.reload();if(out.session_template)ctx.editSession({...out.session_template,event_id:out.id,status:'published'},out.id,true);return;}
 if(action==='restore'){await api(`/api/admin/events/${e.id}/restore`,{method:'POST',body:{}});toast('活動已復原（目前為隱藏），確認後再取消隱藏');return ctx.reload();}
 if(action==='delete'){
  ctx.openEditor('刪除活動',`<form id="delete-form"><p>刪除後活動會從網站與後台列表移除，可在「已刪除的活動」中復原。<strong>報名資料與照片原檔不會被刪除。</strong></p><p>若仍有未結束場次的有效報名，請先把活動狀態改為「已取消」並寄出取消通知。</p><div class="form-field"><label for="confirm-title">請輸入活動名稱「${esc(e.title)}」以確認</label><input id="confirm-title" name="confirm" autocomplete="off" required></div><p class="error" id="edit-error" role="alert"></p><div class="editor-actions"><button class="button danger">刪除活動</button></div></form>`);
  document.querySelector('#delete-form').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await ctx.busy(f.querySelector('button'),async()=>{try{await api(`/api/admin/events/${e.id}/delete`,{method:'POST',body:{confirm_title:f.confirm.value}});ctx.dialog.close();toast('活動已刪除');await ctx.reload();}catch(err){f.querySelector('#edit-error').textContent=err.message;}});};
 }
}

// ---------- Organizer-entered registration ----------
export function addRegistrantDialog(ctx,session){
 ctx.openEditor('新增報名者',`<form id="add-reg"><p class="help">${esc(session.title||'')} · ${esc(dateLabel(session.starts_at))} · ${esc(session.location)}</p><div class="form-grid">
  <div class="form-field"><label for="r-name">姓名</label><input id="r-name" name="name" maxlength="50" required></div>
  <div class="form-field"><label for="r-seats">參加人數</label><input id="r-seats" name="seats" type="number" min="1" max="100000" step="1" value="1" required></div>
  <div class="form-field"><label for="r-email">電子郵件（選填）</label><input id="r-email" name="email" type="email" maxlength="254" autocomplete="off"><p class="help">沒有 Email 的報名不會寄送任何通知。</p></div>
  <div class="form-field"><label for="r-phone">聯絡電話（選填）</label><input id="r-phone" name="phone" maxlength="30" autocomplete="off"></div>
  <div class="form-field"><label for="r-status">報名狀態</label><select id="r-status" name="status"><option value="confirmed">已確認名額</option><option value="pending">待確認</option><option value="waitlisted">候補</option></select></div>
 </div>
 <label class="choice"><input type="checkbox" name="waitlist" checked>名額不足時自動改列候補</label>
 <label class="choice"><input type="checkbox" name="notify" checked>寄送通知信（有 Email 時）</label>
 <label class="choice"><input type="checkbox" name="consent" required>我已向當事人說明個人資料使用方式，並取得同意代為登記</label>
 <p class="error" id="edit-error" role="alert"></p><div class="editor-actions"><button class="button">新增報名</button></div></form>`);
 const submission=crypto.randomUUID();
 document.querySelector('#add-reg').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await ctx.busy(f.querySelector('.editor-actions button'),async()=>{try{
  const r=await api('/api/admin/registrations',{method:'POST',body:{session_id:session.id,name:f.name.value,email:f.email.value,phone:f.phone.value,seats:Number(f.seats.value),status:f.status.value,waitlist_if_full:f.waitlist.checked,notify:f.notify.checked,consent_confirmed:f.consent.checked,submission_id:submission}});
  ctx.dialog.close();toast(`已新增 ${r.code}（${({confirmed:'已確認',pending:'待確認',waitlisted:'候補'})[r.status]||r.status}）`);await ctx.reload();
 }catch(e){f.querySelector('#edit-error').textContent=e.message;}});};
}
export async function purgeRegistration(ctx,r){
 if(!await ctx.confirmAction({title:'永久刪除這筆報名？',action:'永久刪除',danger:true,body:`<p>將刪除 <strong>${esc(r.code)}</strong> 的姓名、聯絡資料、表單答案、報到與通知紀錄。<strong>刪除後無法復原</strong>，統計數字也會一併扣除。</p>`}))return false;
 await api(`/api/admin/registrations/${r.id}/purge`,{method:'POST',body:{}});toast('報名資料已永久刪除');return true;
}

// ---------- Statistics ----------
export async function statsPage(content,me){
 const year=new URLSearchParams(location.search).get('year')||'';
 const data=await api(`/api/admin/stats${year?`?year=${encodeURIComponent(year)}`:''}`),t=data.totals;
 const stat=(n,label,help)=>`<div class="stat"><strong>${n.toLocaleString('zh-TW')}</strong><span>${label}</span>${help?`<small class="cell-sub">${help}</small>`:''}</div>`;
 content.innerHTML=`<div class="toolbar"><div class="filters"><label for="stats-year" class="sr-only">年份</label><select id="stats-year"><option value="">全部年份</option>${data.years.map(y=>`<option value="${esc(y)}" ${sel(y,year)}>${esc(y)} 年</option>`).join('')}</select></div>${me.permissions.includes('export')?'<div class="toolbar-actions"><button class="button secondary" id="stats-export">匯出 CSV</button></div>':''}</div>
 <div class="stats">${stat(t.events,'活動')}${stat(t.sessions,'場次')}${stat(t.registered_people,'有效報名人次','待確認＋已確認')}${stat(t.confirmed_people,'已確認人次')}${stat(t.waitlisted_people,'候補人次')}${stat(t.attended_people,'實際出席人次','現場報到登記')}</div>
 <p class="help">「收到報名」不等於名額確認，也不等於實際出席；三者分開計算。人次依參加人數計算，取消筆數依報名筆數計算。</p>
 <div class="table-wrap"><table><thead><tr><th>活動／場次</th><th>名額</th><th>有效報名</th><th>已確認</th><th>候補</th><th>取消筆數</th><th>出席</th><th>出席率</th></tr></thead><tbody>${data.sessions.map(r=>`<tr><td data-label="活動／場次"><span class="cell-stack"><span>${esc(r.title)}${r.hidden?' <span class="pill">隱藏</span>':''}</span><small class="cell-sub">${esc(dateLabel(r.starts_at))}${r.status==='cancelled'?' · 已取消':''}</small></span></td><td data-label="名額">${r.capacity}</td><td data-label="有效報名">${r.registered_people}</td><td data-label="已確認">${r.confirmed_people}</td><td data-label="候補">${r.waitlisted_people}</td><td data-label="取消筆數">${r.cancelled_registrations}</td><td data-label="出席">${r.attended_people}</td><td data-label="出席率">${r.confirmed_people?Math.round(r.attended_people/r.confirmed_people*100)+'%':'—'}</td></tr>`).join('')||'<tr><td colspan="8">尚無場次資料。</td></tr>'}</tbody></table></div>`;
 document.querySelector('#stats-year').onchange=e=>{history.replaceState(null,'',`?page=stats${e.target.value?`&year=${encodeURIComponent(e.target.value)}`:''}`);statsPage(content,me);};
 document.querySelector('#stats-export')?.addEventListener('click',async()=>{try{const r=await api(`/api/admin/stats/export${year?`?year=${encodeURIComponent(year)}`:''}`);const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=`event-stats${year?'-'+year:''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}});
}

// ---------- Site image upload (banners, About page) ----------
async function uploadSiteImage(file,alt=''){
 if(!file)throw Error('請選擇圖片');return api(`/api/admin/site-images?alt=${encodeURIComponent(alt)}`,{method:'POST',body:file,headers:{'Content-Type':file.type}});
}
const toLocal=v=>localValue(v),toUTC=v=>utcValue(v);

// ---------- Home banners ----------
export async function bannersPage(content,ctx){
 const [list,events]=await Promise.all([api('/api/admin/banners'),api('/api/admin/events')]);
 const eventName=id=>events.find(e=>e.id===id)?.title||'（活動已刪除）';
 content.innerHTML=`<div class="notice">首頁輪播圖依下列順序顯示。圖片依原比例完整呈現；含文字的海報也不會被裁切。<strong>下架</strong>只是暫停顯示，<strong>刪除</strong>會移除 Banner 與未再使用的圖片檔。</div>
 <div class="toolbar"><span>${list.length} 個 Banner</span><button class="button" id="new-banner">＋ 新增 Banner</button></div>
 <div class="banner-admin-list">${list.map((b,i)=>`<article class="panel banner-admin" data-id="${b.id}"><img src="/media/${esc(b.image_id)}" alt="" width="${b.width}" height="${b.height}" loading="lazy"><div class="banner-admin-body"><span class="pill">${b.status==='published'?'上架中':'已下架'}</span><h3>${esc(b.title||b.alt)}</h3><p class="help">${b.event_id?`連到活動：${esc(eventName(b.event_id))}`:b.link_url?`連結：${esc(b.link_url)}`:'無連結'}${b.starts_at||b.ends_at?` · 期間：${b.starts_at?esc(dateLabel(b.starts_at)):'即日起'} – ${b.ends_at?esc(dateLabel(b.ends_at)):'不限'}`:''}</p>
 <div class="editor-actions"><button class="button secondary move" data-dir="up" ${i?'':'disabled'} aria-label="上移 ${esc(b.title||b.alt)}">↑ 上移</button><button class="button secondary move" data-dir="down" ${i<list.length-1?'':'disabled'} aria-label="下移 ${esc(b.title||b.alt)}">↓ 下移</button><button class="button secondary edit">編輯</button><button class="button secondary toggle">${b.status==='published'?'下架':'上架'}</button><button class="button danger remove">刪除</button></div></div></article>`).join('')||'<p class="empty">尚無 Banner；首頁會顯示網站名稱與標語。</p>'}</div>`;
 const reload=()=>bannersPage(content,ctx);
 const find=el=>list.find(b=>b.id===el.closest('[data-id]').dataset.id);
 document.querySelector('#new-banner').onclick=()=>bannerEditor(ctx,events,{status:'published'},reload);
 for(const b of content.querySelectorAll('.edit'))b.onclick=()=>bannerEditor(ctx,events,find(b),reload);
 for(const b of content.querySelectorAll('.move'))b.onclick=async()=>{try{await api(`/api/admin/banners/${find(b).id}/move`,{method:'POST',body:{direction:b.dataset.dir}});await reload();}catch(e){toast(e.message);}};
 for(const b of content.querySelectorAll('.toggle'))b.onclick=async()=>{const x=find(b);try{await api(`/api/admin/banners/${x.id}`,{method:'PATCH',body:{status:x.status==='published'?'hidden':'published'}});toast(x.status==='published'?'已下架':'已上架');await reload();}catch(e){toast(e.message);}};
 for(const b of content.querySelectorAll('.remove'))b.onclick=async()=>{const x=find(b);if(!await ctx.confirmAction({title:'刪除這個 Banner？',action:'刪除 Banner',danger:true,body:`<p>將刪除「${esc(x.title||x.alt)}」。若圖片沒有用在其他地方，圖片檔也會一併刪除，<strong>無法復原</strong>。只想暫停顯示請改用「下架」。</p>`}))return;try{await api(`/api/admin/banners/${x.id}/delete`,{method:'POST',body:{}});toast('Banner 已刪除');await reload();}catch(e){toast(e.message);}};
}
function bannerEditor(ctx,events,b,reload){
 const isNew=!b.id;
 ctx.openEditor(isNew?'新增 Banner':'編輯 Banner',`<form id="banner-form"><div class="form-grid">
  <div class="form-field wide"><label for="b-file">圖片${isNew?'':'（選填，換一張圖）'}</label><input id="b-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" ${isNew?'required':''}><p class="help">建議 1920×640（3:1）或 1920×1080（16:9），JPG／WebP 1 MB 內。手機上圖會縮很小，標題字高至少 80px；直式海報也會完整顯示，但兩側會留白。</p></div>
  <div class="form-field wide"><label for="b-alt">圖片替代文字（必填）</label><input id="b-alt" name="alt" maxlength="300" required value="${esc(b.alt||'')}" placeholder="描述圖片內容，例如：夏日市集海報，7/20 下午兩點"></div>
  <div class="form-field"><label for="b-title">標題（選填）</label><input id="b-title" name="title" maxlength="200" value="${esc(b.title||'')}"></div>
  <div class="form-field"><label for="b-sub">副標（選填）</label><input id="b-sub" name="subtitle" maxlength="300" value="${esc(b.subtitle||'')}" placeholder="留空時自動顯示活動日期"></div>
  <div class="form-field"><label for="b-event">連到活動（選填）</label><select id="b-event" name="event_id"><option value="">不連到活動</option>${events.map(e=>`<option value="${esc(e.id)}" ${sel(e.id,b.event_id)}>${esc(e.title)}</option>`).join('')}</select></div>
  <div class="form-field"><label for="b-link">或連到網址（選填）</label><input id="b-link" name="link_url" maxlength="500" value="${esc(b.link_url||'')}" placeholder="https://… 或 /about.html"></div>
  <div class="form-field"><label for="b-start">上架時間（選填）</label><input id="b-start" type="datetime-local" name="starts_at" value="${toLocal(b.starts_at)}"></div>
  <div class="form-field"><label for="b-end">下架時間（選填）</label><input id="b-end" type="datetime-local" name="ends_at" value="${toLocal(b.ends_at)}"></div>
  <div class="form-field"><label for="b-status">狀態</label><select id="b-status" name="status"><option value="published" ${sel(b.status,'published')}>上架</option><option value="hidden" ${sel(b.status,'hidden')}>下架</option></select></div>
 </div><p class="error" id="edit-error" role="alert"></p><div class="editor-actions"><button class="button">儲存</button></div></form>`);
 document.querySelector('#banner-form').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await ctx.busy(f.querySelector('.editor-actions button'),async()=>{try{
  let image_id=b.image_id;const file=f.file.files[0];if(file)image_id=(await uploadSiteImage(file,f.alt.value)).id;
  const body={image_id,alt:f.alt.value,title:f.title.value,subtitle:f.subtitle.value,event_id:f.event_id.value||null,link_url:f.link_url.value||null,starts_at:toUTC(f.starts_at.value),ends_at:toUTC(f.ends_at.value),status:f.status.value};
  await api(`/api/admin/banners/${isNew?'':b.id}`,{method:isNew?'POST':'PATCH',body});ctx.dialog.close();toast('Banner 已儲存');await reload();
 }catch(e){f.querySelector('#edit-error').textContent=e.message;}});};
}

// ---------- About page editor ----------
const blockTypes={hero:'主標題',text:'文字段落',cards:'卡片',image_text:'圖文並排',links:'連結清單',contact:'聯絡資訊'};
const blankBlock=type=>({hero:{type,title:'關於我們',text:'',tone:'accent'},text:{type,heading:'',body:''},cards:{type,heading:'',columns:3,items:[{title:'',text:''}]},image_text:{type,heading:'',body:'',image_side:'left',alt:''},links:{type,heading:'相關連結',items:[{label:'',note:'',url:''}]},contact:{type,heading:'聯絡我們',body:''}})[type];
export async function aboutEditor(content,ctx){
 const data=await api('/api/admin/about');let blocks=structuredClone(Array.isArray(data.blocks)?data.blocks:data.fallback);let dirty=false;
 const field=(i,key,label,value,{area=false,max=500}={})=>`<div class="form-field ${area?'wide':''}"><label for="ab-${i}-${key}">${label}</label>${area?`<textarea id="ab-${i}-${key}" data-k="${key}" rows="4" maxlength="${max}">${esc(value||'')}</textarea>`:`<input id="ab-${i}-${key}" data-k="${key}" maxlength="${max}" value="${esc(value||'')}">`}</div>`;
 const items=(i,b,kind)=>`<div class="about-items" data-items="${kind}">${(b.items||[]).map((it,j)=>`<div class="about-item" data-j="${j}">${kind==='cards'?`<div class="form-field"><label for="ab-${i}-it${j}-t">卡片 ${j+1} 標題</label><input id="ab-${i}-it${j}-t" data-ik="title" maxlength="80" value="${esc(it.title||'')}"></div><div class="form-field wide"><label for="ab-${i}-it${j}-x">卡片 ${j+1} 內容</label><textarea id="ab-${i}-it${j}-x" data-ik="text" rows="2" maxlength="400">${esc(it.text||'')}</textarea></div>`:`<div class="form-field"><label for="ab-${i}-it${j}-l">連結 ${j+1} 名稱</label><input id="ab-${i}-it${j}-l" data-ik="label" maxlength="80" value="${esc(it.label||'')}"></div><div class="form-field"><label for="ab-${i}-it${j}-u">網址</label><input id="ab-${i}-it${j}-u" data-ik="url" maxlength="500" value="${esc(it.url||'')}" placeholder="https://、/、mailto: 或 tel:"></div><div class="form-field wide"><label for="ab-${i}-it${j}-n">說明（選填）</label><input id="ab-${i}-it${j}-n" data-ik="note" maxlength="160" value="${esc(it.note||'')}"></div>`}<button type="button" class="button secondary remove-item" data-j="${j}">移除這${kind==='cards'?'張卡片':'個連結'}</button></div>`).join('')}<button type="button" class="button secondary add-item" ${(b.items||[]).length>=12?'disabled':''}>＋ 新增${kind==='cards'?'卡片':'連結'}</button></div>`;
 const blockForm=(b,i)=>{
  const common=`<div class="form-field"><label for="ab-${i}-tone">底色</label><select id="ab-${i}-tone" data-k="tone"><option value="plain" ${sel(b.tone,'plain')}>無底色</option><option value="tinted" ${sel(b.tone,'tinted')}>淡色底</option><option value="accent" ${sel(b.tone,'accent')}>強調色</option></select></div><div class="form-field"><label for="ab-${i}-align">對齊</label><select id="ab-${i}-align" data-k="align"><option value="left" ${sel(b.align,'left')}>靠左</option><option value="center" ${sel(b.align,'center')}>置中</option></select></div>`;
  let body='';
  if(b.type==='hero')body=field(i,'title','標題',b.title,{max:120})+field(i,'text','說明',b.text,{area:true,max:600});
  else if(b.type==='text'||b.type==='contact')body=field(i,'heading','標題（選填）',b.heading,{max:120})+field(i,'body',b.type==='contact'?'聯絡資訊':'內文（空一行分段）',b.body,{area:true,max:b.type==='contact'?1000:5000});
  else if(b.type==='cards')body=field(i,'heading','標題（選填）',b.heading,{max:120})+`<div class="form-field"><label for="ab-${i}-cols">每列卡片數（桌面）</label><select id="ab-${i}-cols" data-k="columns">${[2,3,4].map(n=>`<option value="${n}" ${b.columns===n?'selected':''}>${n} 張</option>`).join('')}</select></div>`+items(i,b,'cards');
  else if(b.type==='image_text')body=field(i,'heading','標題（選填）',b.heading,{max:120})+field(i,'body','內文',b.body,{area:true,max:3000})+`<div class="form-field"><label for="ab-${i}-side">圖片位置</label><select id="ab-${i}-side" data-k="image_side"><option value="left" ${sel(b.image_side,'left')}>左邊</option><option value="right" ${sel(b.image_side,'right')}>右邊</option></select></div><div class="form-field wide"><label for="ab-${i}-img">圖片${b.image_id?'（已上傳，可更換）':''}</label>${b.image_id?`<img class="about-thumb" src="/media/${esc(b.image_id)}" alt="">`:''}<input id="ab-${i}-img" type="file" class="block-image" accept="image/jpeg,image/png,image/webp"><p class="help">建議 1200×900（4:3）。</p></div>`+field(i,'alt','圖片說明（替代文字，必填）',b.alt,{max:300});
  else if(b.type==='links')body=field(i,'heading','標題（選填）',b.heading,{max:120})+items(i,b,'links');
  return `<section class="panel about-block-editor" data-i="${i}"><div class="toolbar"><h3>${i+1}. ${esc(blockTypes[b.type]||b.type)}</h3><div class="editor-actions"><button type="button" class="button secondary block-move" data-dir="-1" ${i?'':'disabled'} aria-label="上移第 ${i+1} 個區塊">↑</button><button type="button" class="button secondary block-move" data-dir="1" ${i<blocks.length-1?'':'disabled'} aria-label="下移第 ${i+1} 個區塊">↓</button><button type="button" class="button danger block-remove" aria-label="刪除第 ${i+1} 個區塊">刪除</button></div></div><div class="form-grid">${body}${common}</div></section>`;
 };
 const read=()=>{for(const sec of content.querySelectorAll('.about-block-editor')){const b=blocks[Number(sec.dataset.i)];for(const el of sec.querySelectorAll('[data-k]'))b[el.dataset.k]=el.dataset.k==='columns'?Number(el.value):el.value;const box=sec.querySelector('[data-items]');if(box)b.items=[...box.querySelectorAll('.about-item')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-ik]')].map(el=>[el.dataset.ik,el.value])));}};
 const draw=()=>{
  content.innerHTML=`<div class="notice">「關於我們」頁由下列區塊組成，可自由新增、排序與設定樣式。儲存後立即生效，<a href="/about.html" target="_blank" rel="noopener">開新分頁預覽 ↗</a></div>
  <div id="about-block-list">${blocks.map(blockForm).join('')||'<p class="empty">尚無區塊，將顯示預設內容。</p>'}</div>
  <div class="toolbar"><div class="filters"><label for="new-block-type">新增區塊</label><select id="new-block-type">${Object.entries(blockTypes).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><button type="button" class="button secondary" id="add-block" ${blocks.length>=30?'disabled':''}>＋ 新增</button></div><div class="toolbar-actions"><button type="button" class="button secondary" id="reset-about">還原為預設內容</button><button type="button" class="button" id="save-about">儲存</button></div></div><p class="error" id="about-error" role="alert"></p>`;
  content.oninput=()=>{dirty=true;};
  document.querySelector('#add-block').onclick=()=>{read();blocks.push(blankBlock(document.querySelector('#new-block-type').value));dirty=true;draw();content.querySelector('.about-block-editor:last-of-type input,.about-block-editor:last-of-type textarea')?.focus();};
  for(const b of content.querySelectorAll('.block-move'))b.onclick=()=>{read();const i=Number(b.closest('[data-i]').dataset.i),j=i+Number(b.dataset.dir);[blocks[i],blocks[j]]=[blocks[j],blocks[i]];dirty=true;draw();};
  for(const b of content.querySelectorAll('.block-remove'))b.onclick=()=>{read();blocks.splice(Number(b.closest('[data-i]').dataset.i),1);dirty=true;draw();};
  for(const b of content.querySelectorAll('.add-item'))b.onclick=()=>{read();const blk=blocks[Number(b.closest('[data-i]').dataset.i)];blk.items=[...(blk.items||[]),blk.type==='cards'?{title:'',text:''}:{label:'',note:'',url:''}];dirty=true;draw();};
  for(const b of content.querySelectorAll('.remove-item'))b.onclick=()=>{read();const blk=blocks[Number(b.closest('[data-i]').dataset.i)];blk.items.splice(Number(b.dataset.j),1);dirty=true;draw();};
  for(const input of content.querySelectorAll('.block-image'))input.onchange=async()=>{read();const i=Number(input.closest('[data-i]').dataset.i);try{const img=await uploadSiteImage(input.files[0],blocks[i].alt||'');blocks[i].image_id=img.id;dirty=true;toast('圖片已上傳，記得按儲存');draw();}catch(e){toast(e.message);}};
  document.querySelector('#reset-about').onclick=async()=>{if(!await ctx.confirmAction({title:'還原為預設內容？',action:'還原',body:'<p>會以 site.config.json 的預設內容取代目前尚未儲存的編輯；按「儲存」後才會生效。</p>'}))return;blocks=structuredClone(data.fallback);dirty=true;draw();};
  document.querySelector('#save-about').onclick=async ev=>{read();await ctx.busy(ev.currentTarget,async()=>{try{const out=await api('/api/admin/about',{method:'PUT',body:{blocks}});blocks=out.blocks;dirty=false;toast('關於我們頁面已更新');draw();}catch(e){document.querySelector('#about-error').textContent=e.message;}});};
 };
 draw();
 const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};addEventListener('beforeunload',warn);
 return ()=>removeEventListener('beforeunload',warn);
}

// ---------- Site appearance: colors and icon ----------
// Contrast follows WCAG 2.x, mirroring src/theme-css.js so the owner sees problems before saving.
const rgbOf=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const lumOf=h=>{const [r,g,b]=rgbOf(h).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
const ratio=(a,b)=>{const [x,y]=[lumOf(a),lumOf(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
const tintOf=(h,p)=>'#'+rgbOf(h).map(v=>Math.round(v*p+255*(1-p)).toString(16).padStart(2,'0')).join('');
const paletteFields=[['brand','主色','連結、淡色背景、邊框'],['deep','深色','大標題、強調文字'],['action','按鈕色','「我要報名」等按鈕（白字）'],['ink','內文色','一般文字'],['accent','點綴色','亮點、徽章、輪播指示']];
const checks=p=>[['按鈕白字',ratio(p.action,'#ffffff'),4.5],['深色標題',ratio(p.deep,'#ffffff'),4.5],['內文',ratio(p.ink,tintOf(p.accent,.08)),7],['主色連結',ratio(p.brand,'#ffffff'),3]];
const previewMarkup=`<div class="theme-preview" aria-label="配色預覽"><div class="tp-header"><span class="brand-mark" aria-hidden="true">社</span><strong>社區活動報名</strong><span class="tp-nav">社區活動　關於我們</span></div><div class="tp-hero"><p class="eyebrow">COMMUNITY EVENTS</p><h3>一起參加社區活動</h3><p>找到適合的場次，和鄰居一起來參與。</p></div><div class="tp-card"><span class="pill">開放報名</span><h4>親子手作：秋天的葉子拓印</h4><p class="tp-meta">2026/12/12（六）14:00 · 活動中心 <span class="fee-badge fee-paid">收費</span> 每人 150 元</p><div class="tp-actions"><span class="button">我要報名 ↗</span><span class="tp-link">＋ 加入行事曆</span></div></div></div>`;
export async function appearancePage(content,ctx){
 const data=await api('/api/admin/appearance');
 let choice=typeof data.theme==='string'?data.theme:'custom';
 let custom={...(data.palette.id==='custom'?data.palette:data.presets[0])};
 content.innerHTML=`<section class="panel"><h2>網站配色</h2><p class="help">選一組預設配色，或自訂五個顏色。儲存後住戶網站立即套用；所有預設配色都通過文字對比檢查。</p>
 <div class="theme-grid" role="radiogroup" aria-label="網站配色">${data.presets.map(t=>`<label class="theme-option"><input type="radio" name="theme" value="${esc(t.id)}" ${choice===t.id?'checked':''}><span class="theme-swatch" data-swatch="${esc(t.id)}" aria-hidden="true"></span><span>${esc(t.name)}</span></label>`).join('')}<label class="theme-option"><input type="radio" name="theme" value="custom" ${choice==='custom'?'checked':''}><span class="theme-swatch" data-swatch="custom" aria-hidden="true"></span><span>自訂</span></label></div>
 <fieldset class="custom-palette" id="custom-palette"><legend>自訂顏色</legend><div class="form-grid">${paletteFields.map(([k,label,help])=>`<div class="form-field"><label for="pc-${k}">${label}</label><div class="color-pair"><input type="color" id="pc-${k}" data-k="${k}" value="${esc(custom[k])}"><input type="text" class="hex" data-hex="${k}" value="${esc(custom[k])}" maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="${label}色碼" spellcheck="false"></div><p class="help">${help}</p></div>`).join('')}</div>
 <p class="help">從某組預設開始調整：<select id="start-from" aria-label="從預設配色開始">${data.presets.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select> <button type="button" class="button secondary" id="copy-preset">套用到自訂</button></p></fieldset>
 <div class="contrast-list" id="contrast-list" aria-live="polite"></div>
 <h3>預覽</h3>${previewMarkup}
 <p class="error" id="theme-error" role="alert"></p><div class="editor-actions"><a class="button secondary" href="/" target="_blank" rel="noopener">開啟網站 ↗</a><button type="button" class="button" id="save-theme">儲存配色</button></div></section>
 <section class="panel"><h2>網站圖示</h2><p class="help">顯示在瀏覽器分頁、書籤與手機主畫面。建議上傳正方形、簡單清楚的圖（PNG／JPG／WebP），系統會自動做成 512×512 與 180×180 兩種尺寸。</p>
 <div class="icon-row"><figure class="icon-preview"><img id="icon-current" src="/favicon-512.png?v=${Date.now()}" alt="目前的網站圖示" width="96" height="96"><figcaption>目前圖示${data.icon?'（自訂）':'（預設）'}</figcaption></figure>
 <div class="icon-form"><div class="form-field"><label for="icon-file">選擇圖片</label><input id="icon-file" type="file" accept="image/png,image/jpeg,image/webp"></div>
 <div class="form-field"><label for="icon-fit">圖片不是正方形時</label><select id="icon-fit"><option value="cover">裁切成正方形（置中）</option><option value="contain">完整顯示，四周留白</option></select></div>
 <div class="form-field"><label for="icon-bg">手機主畫面圖示的底色</label><select id="icon-bg"><option value="#ffffff">白色</option><option value="brand">配色主色</option></select><p class="help">iPhone 主畫面不支援透明背景，透明處會用這個顏色。</p></div>
 <div class="icon-previews" id="icon-previews" hidden><figure><canvas id="icon-512" width="512" height="512" aria-label="512 預覽"></canvas><figcaption>瀏覽器分頁</figcaption></figure><figure><canvas id="icon-180" width="180" height="180" class="rounded" aria-label="180 預覽"></canvas><figcaption>手機主畫面</figcaption></figure></div>
 <p class="error" id="icon-error" role="alert"></p><div class="editor-actions"><button type="button" class="button secondary" id="icon-reset" ${data.icon?'':'disabled'}>恢復預設圖示</button><button type="button" class="button" id="icon-save" disabled>儲存圖示</button></div></div></div></section>`;
 const paint=(el,p)=>el.style.setProperty('background',`linear-gradient(135deg,${p.brand} 0 45%,${p.action} 45% 75%,${p.accent} 75%)`);
 for(const sw of content.querySelectorAll('[data-swatch]'))if(sw.dataset.swatch!=='custom')paint(sw,data.presets.find(t=>t.id===sw.dataset.swatch));
 let link=document.querySelector('#theme-preview-css');if(!link){link=document.createElement('link');link.rel='stylesheet';link.id='theme-preview-css';document.head.append(link);}
 const current=()=>choice==='custom'?custom:data.presets.find(t=>t.id===choice);
 const refresh=()=>{
  const p=current();content.querySelector('#custom-palette').hidden=choice!=='custom';paint(content.querySelector('[data-swatch=custom]'),custom);
  link.href=`/theme.css?preview=1&${choice==='custom'?new URLSearchParams(Object.fromEntries(paletteFields.map(([k])=>[k,custom[k]]))):`theme=${encodeURIComponent(choice)}`}`;
  const list=checks(p);content.querySelector('#contrast-list').innerHTML=list.map(([label,v,min])=>`<span class="contrast ${v>=min?'ok':'bad'}">${v>=min?'✓':'✗'} ${label} ${v.toFixed(1)}:1<small>（至少 ${min}）</small></span>`).join('');
  content.querySelector('#save-theme').disabled=list.some(([,v,min])=>v<min);
 };
 for(const r of content.querySelectorAll('input[name=theme]'))r.onchange=()=>{choice=r.value;refresh();};
 for(const c of content.querySelectorAll('input[type=color]'))c.oninput=()=>{custom[c.dataset.k]=c.value;content.querySelector(`[data-hex=${c.dataset.k}]`).value=c.value;refresh();};
 for(const t of content.querySelectorAll('.hex'))t.oninput=()=>{if(/^#[0-9a-f]{6}$/i.test(t.value)){custom[t.dataset.hex]=t.value.toLowerCase();content.querySelector(`#pc-${t.dataset.hex}`).value=custom[t.dataset.hex];refresh();}};
 content.querySelector('#copy-preset').onclick=()=>{const t=data.presets.find(x=>x.id===content.querySelector('#start-from').value);for(const [k] of paletteFields){custom[k]=t[k];content.querySelector(`#pc-${k}`).value=t[k];content.querySelector(`[data-hex=${k}]`).value=t[k];}refresh();};
 content.querySelector('#save-theme').onclick=ev=>ctx.busy(ev.currentTarget,async()=>{const err=content.querySelector('#theme-error');err.textContent='';try{await api('/api/admin/appearance',{method:'PUT',body:{theme:choice==='custom'?{id:'custom',...Object.fromEntries(paletteFields.map(([k])=>[k,custom[k]]))}:choice}});toast('網站配色已更新');}catch(e){err.textContent=e.details?.palette?`${e.message}：${e.details.palette}`:e.message;}});
 refresh();
 // Icon: draw into square canvases in the browser, upload both PNGs, then point the settings at them.
 let bitmap=null;const c512=content.querySelector('#icon-512'),c180=content.querySelector('#icon-180');
 const draw=(canvas,bg)=>{const ctx2=canvas.getContext('2d'),s=canvas.width;ctx2.clearRect(0,0,s,s);if(bg){ctx2.fillStyle=bg;ctx2.fillRect(0,0,s,s);}
  const fit=content.querySelector('#icon-fit').value,scale=fit==='cover'?Math.max(s/bitmap.width,s/bitmap.height):Math.min(s/bitmap.width,s/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;
  ctx2.imageSmoothingQuality='high';ctx2.drawImage(bitmap,(s-w)/2,(s-h)/2,w,h);};
 const redraw=()=>{if(!bitmap)return;const bgSel=content.querySelector('#icon-bg').value;draw(c512,null);draw(c180,bgSel==='brand'?current().brand:bgSel);content.querySelector('#icon-previews').hidden=false;content.querySelector('#icon-save').disabled=false;};
 content.querySelector('#icon-file').onchange=async e=>{const f=e.target.files[0];content.querySelector('#icon-error').textContent='';if(!f)return;try{bitmap=await createImageBitmap(f);if(bitmap.width<64||bitmap.height<64)throw Error('圖片太小，請至少 64×64，建議 512×512 以上');redraw();}catch(err){bitmap=null;content.querySelector('#icon-error').textContent=err.message||'無法讀取這張圖片';}};
 content.querySelector('#icon-fit').onchange=redraw;content.querySelector('#icon-bg').onchange=redraw;
 const png=canvas=>new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(Error('無法產生圖示')),'image/png'));
 content.querySelector('#icon-save').onclick=ev=>ctx.busy(ev.currentTarget,async()=>{const err=content.querySelector('#icon-error');err.textContent='';try{
  const up=async c=>(await api('/api/admin/site-images?alt=%E7%B6%B2%E7%AB%99%E5%9C%96%E7%A4%BA',{method:'POST',body:await png(c),headers:{'Content-Type':'image/png'}})).id;
  await api('/api/admin/appearance/icon',{method:'PUT',body:{icon_id:await up(c512),apple_id:await up(c180)}});toast('網站圖示已更新；瀏覽器可能需要重新整理才會看到');await appearancePage(content,ctx);
 }catch(e){err.textContent=e.message;}});
 content.querySelector('#icon-reset').onclick=async ev=>{if(!await ctx.confirmAction({title:'恢復預設圖示？',action:'恢復預設',body:'<p>會移除你上傳的網站圖示，改回模板內建圖示。</p>'}))return;await ctx.busy(ev.currentTarget,async()=>{try{await api('/api/admin/appearance/icon',{method:'PUT',body:{reset:true}});toast('已恢復預設圖示');await appearancePage(content,ctx);}catch(e){content.querySelector('#icon-error').textContent=e.message;}});};
 return ()=>link.remove();
}
