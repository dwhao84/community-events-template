import {api,esc,toast,dateLabel} from '../shared.js';
import {siteConfig} from '../site.js';
let identities=['社區住戶','附近居民','其他'];siteConfig().then(c=>{if(Array.isArray(c.identities)&&c.identities.length)identities=c.identities;});
import {signaturePad} from './signature.js';
import {timeRange} from './signin-format.js';
export async function checkinPage(content,me){
 const sessions=await api('/api/admin/checkins/sessions');
 if(!sessions.length){content.innerHTML='<p class="empty">尚無已發布的場次。</p>';return ()=>{};}
 let saving=false;
 let sid=(sessions.find(s=>s.id===new URLSearchParams(location.search).get('checkin_session'))||sessions.find(s=>Date.parse(s.ends_at)>Date.now())||sessions.at(-1)).id,disposed=false,revision=0;
 content.innerHTML=`<div class="toolbar"><label>活動場次 <select id="checkin-session">${sessions.map(s=>`<option value="${esc(s.id)}" ${s.id===sid?'selected':''}>${esc(dateLabel(s.starts_at))} · ${esc(s.title)}${s.status==='cancelled'?'（已取消）':''}</option>`).join('')}</select></label>${me.permissions.includes('export')?'<button class="button secondary" id="print-sheet">活動簽到表／列印</button>':''}</div><div id="onsite-tools"></div><div class="stats" id="checkin-stats"></div><section class="panel" id="lookup-panel"><h3>活動簽到</h3><p>工作人員可依姓名、Email 或報名編號查找報名，確認後交由參加者手寫簽名。</p><form id="lookup-form"><div class="form-field"><label for="lookup-name">報名姓名、Email 或編號</label><input id="lookup-name" maxlength="254" required autocomplete="off"></div><button class="button">搜尋報名</button></form><div id="lookup-results" aria-live="polite"></div></section><section class="panel" id="attendee-panel" hidden></section><section class="panel"><h3>報到清單</h3><div id="checkin-list"></div></section>`;
 const $=s=>content.querySelector(s),panel=$('#attendee-panel');
 async function refresh(){const version=revision,data=await api(`/api/admin/checkins?session_id=${encodeURIComponent(sid)}`);if(disposed||version!==revision)return;const {expected,checkins}=data;
 $('#checkin-stats').innerHTML=`<div class="stat"><strong>${checkins.length}</strong><span>已報到筆數</span></div><div class="stat"><strong>${checkins.reduce((n,r)=>n+r.named,0)}</strong><span>已填姓名人數</span></div><div class="stat"><strong>${expected.seats}</strong><span>應到人數</span></div>`;
 $('#checkin-list').innerHTML=checkins.length?`<ul class="checkin-list">${checkins.map(r=>`<li><div><strong>${esc(r.name||'參加者')}</strong><span>報名 ${r.seats} 位 · 已填 ${r.named} 位</span></div><button class="button secondary" data-code="${esc(r.code)}">修改簽到</button></li>`).join('')}</ul>`:'<p>尚無報到紀錄。</p>';$('#checkin-list').querySelectorAll('button').forEach(b=>b.onclick=()=>open(b.dataset.code));}
 async function open(code){if(saving)return;const version=revision;try{const r=await api('/api/admin/checkins',{method:'POST',body:{session_id:sid,code}});if(disposed||version!==revision)return;editor(r);await refresh();}catch(e){toast(e.message);}}
 function close(){$('#onsite-tools').hidden=false;panel.hidden=true;panel.innerHTML='';$('#lookup-panel').hidden=false;$('#lookup-name').focus();}
 function editor(r,onsite=null){
 $('#lookup-panel').hidden=true;$('#onsite-tools').hidden=true;panel.hidden=false;let people=r.people.map(p=>({...p,signature:p.signature_json?JSON.parse(p.signature_json):[]})),pads=[];
 const session=sessions.find(s=>s.id===sid);if(!people.length)people=[{full_name:r.nickname||'',fee_status:r.fee_snapshot==='免費'?'free':'',signature:r.name_signature_json?JSON.parse(r.name_signature_json):[]}];
 let submissionId=crypto.randomUUID();
 panel.innerHTML=`<h3>活動簽到表</h3><p><strong>${esc(session.title)} – 簽到單 (#${esc(session.event_id||session.id)})</strong></p><p>時間：${esc(timeRange(session.starts_at,session.ends_at))}<br>地點：${esc(session.location||'')}</p><p>請幫我填寫真實姓名，並在簽名框用手指或觸控筆手寫簽名。簽名僅供本場活動簽到使用。</p><p>${r.status==='pending'?'此報名名額仍待確認，請由工作人員核對。':''}</p><form id="attendee-form">${onsite?'<p class="notice">現場報名：請填寫到場者資料並簽名，送出後完成報名與簽到。額滿時不會受理。</p><div class="form-field"><label for="onsite-email">電子郵件（報名聯絡用，不列印於簽到表）</label><input id="onsite-email" type="email" maxlength="254" autocomplete="off" required></div>':''}<label for="arrived">今天到場人數</label><select id="arrived">${Array.from({length:Math.min(r.seats,100)},(_,i)=>`<option value="${i+1}" ${i+1===(people.length||1)?'selected':''}>${i+1} 位</option>`).join('')}</select><div id="people"></div>${onsite?`<section class="consent" id="onsite-consent"><strong>個人資料使用說明</strong><p>${esc(onsite.privacy.summary)}</p><details><summary>閱讀完整說明</summary><p>${esc(onsite.privacy.body)}</p></details><p>${esc(onsite.privacy.onsite_notice)}</p><label><input type="checkbox" id="onsite-privacy" required>我已閱讀並同意以上個人資料使用說明。</label><label><input type="checkbox" id="onsite-participation" required>${esc(onsite.privacy.statement)}</label></section>`:''}<p id="sign-error" class="error" role="alert"></p><div class="editor-actions"><button class="button" id="save-sign">${onsite?'完成報名與簽到':'儲存簽到'}</button><button class="button secondary" type="button" id="back-sign">返回工作人員</button>${onsite?'':'<button class="button secondary" type="button" id="undo-sign">復原報到</button>'}</div></form>`;
 const fields=$('#people');
 const read=()=>Array.from(fields.children,(el,i)=>{
  const choice=el.querySelector('[data-sex]:checked')?.value||'',fee=el.querySelector('[data-fee]:checked')?.value||'';
  return {full_name:el.querySelector('[data-name]').value.trim(),signature:pads[i].read(),age_group:choice.split('/')[0]||'',gender:choice.split('/')[1]||'',identity:el.querySelector('[data-identity]:checked')?.value||'',fee_status:fee,fee_amount:fee==='paid'?Number(el.querySelector('[data-amount]').value):null};
 });
 const draw=()=>{
 fields.innerHTML=Array.from({length:Number($('#arrived').value)},(_,i)=>{
  const p=people[i]||{},fee=p.fee_status??(r.fee_snapshot==='免費'?'free':'');
  return `<fieldset class="signature-person"><legend>序號 ${i+1}</legend><div class="form-field"><label for="person-${i}">姓名</label><p class="help">請幫我填寫真實姓名，${onsite?'每位到場者請分別填寫並簽名。':'報名姓名已自動帶入，可修改為本位到場者姓名。'}</p><input data-name id="person-${i}" value="${esc(p.full_name||'')}" maxlength="50" autocomplete="off"></div><p id="pad-help-${i}">姓名欄手寫簽名：請用手指或觸控筆簽名，可清除或復原上一筆。若無法手寫，請由工作人員協助填寫姓名。</p><canvas class="signature-pad" width="800" height="280" aria-label="第 ${i+1} 位手寫簽名區" aria-describedby="pad-help-${i}"></canvas><div class="editor-actions"><button type="button" data-clear="${i}" class="button secondary">清除簽名</button><button type="button" data-undo="${i}" class="button secondary">復原上一筆</button></div><fieldset class="signin-options"><legend>性別</legend><div class="signin-sex-grid">${['大','小'].map(age=>`<div class="signin-sex-row"><strong>${age}</strong>${['男','女','其他'].map(gender=>`<label class="choice"><input data-sex type="radio" name="sex-${i}" value="${age}/${gender}" ${p.age_group===age&&p.gender===gender?'checked':''}>${gender}</label>`).join('')}</div>`).join('')}</div><label class="choice"><input data-sex type="radio" name="sex-${i}" value="" ${!p.age_group||!p.gender?'checked':''}>未填寫</label></fieldset><fieldset class="signin-options"><legend>身分</legend>${identities.map(v=>`<label class="choice"><input data-identity type="radio" name="identity-${i}" value="${v}" ${p.identity===v?'checked':''}>${v}</label>`).join('')}<label class="choice"><input data-identity type="radio" name="identity-${i}" value="" ${!p.identity?'checked':''}>未填寫</label></fieldset><fieldset class="signin-options"><legend>活動收費情形</legend><p class="help">場次費用：${esc(r.fee_snapshot||'待定')}。繳費請由工作人員確認後勾選。</p><label class="choice"><input data-fee type="radio" name="fee-${i}" value="free" ${fee==='free'?'checked':''}>免費</label><label class="choice"><input data-fee type="radio" name="fee-${i}" value="paid" ${fee==='paid'?'checked':''}>繳費</label><label for="amount-${i}">繳費金額（元）</label><input data-amount id="amount-${i}" type="number" min="0" max="1000000" step="1" inputmode="numeric" value="${p.fee_amount??''}" ${fee==='paid'?'required':'disabled'}><label class="choice"><input data-fee type="radio" name="fee-${i}" value="" ${fee===''?'checked':''}>未填寫</label></fieldset></fieldset>`;
 }).join('');
 pads=Array.from(fields.querySelectorAll('canvas'),(c,i)=>signaturePad(c,people[i]?.signature||[]));
 fields.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>pads[b.dataset.clear].clear());fields.querySelectorAll('[data-undo]').forEach(b=>b.onclick=()=>pads[b.dataset.undo].undo());
 for(const el of fields.children)el.querySelectorAll('[data-fee]').forEach(input=>input.onchange=()=>{const amount=el.querySelector('[data-amount]'),paid=el.querySelector('[data-fee]:checked').value==='paid';amount.disabled=!paid;amount.required=paid;});
 };
 $('#arrived').onchange=()=>{people=read().concat(people.slice(fields.children.length));draw();};draw();
 $('#attendee-form').onsubmit=async e=>{
 e.preventDefault();if(saving)return;const list=read(),error=$('#sign-error');
 if(onsite&&list.some(p=>!p.signature.length)){error.textContent='請完成每位到場者的手寫簽名';return;}
 saving=true;$('#checkin-session').disabled=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);
 const body={names:list.map(p=>p.full_name),people:list.map(p=>({...p,signature:p.signature.length?p.signature:null}))};
 try{
  if(onsite)await api('/api/admin/checkins/onsite',{method:'POST',body:{...body,session_id:sid,email:$('#onsite-email').value,form_id:onsite.form_id,privacy_version:onsite.privacy.version,privacy_consent:$('#onsite-privacy').checked,participation_consent:$('#onsite-participation').checked,submission_id:submissionId}});
  else await api(`/api/admin/checkins/${encodeURIComponent(r.registration_id)}/attendees`,{method:'PUT',body});
  close();toast(onsite?'報名成功，已完成簽到並帶入活動簽到表。':'已儲存，資料與手寫簽名已直接帶入活動簽到表。');
  await refresh().catch(()=>toast('資料已儲存，清單暫時無法更新，請重新整理。'));
 }catch(e){
  error.textContent=e.message;
  if(onsite&&e.details?.reload){try{onsite=await api(`/api/admin/checkins/onsite?session_id=${encodeURIComponent(sid)}`);$('#onsite-consent p').textContent=onsite.privacy.summary;$('#onsite-consent details p').textContent=onsite.privacy.body;$('#onsite-privacy').checked=false;$('#onsite-participation').checked=false;$('#onsite-participation').parentElement.lastChild.textContent=onsite.privacy.statement;error.textContent='個資說明或表單已更新，請重新閱讀並勾選同意後再送出。';}catch{error.textContent='無法載入最新說明，請稍後重試。';}}
 }finally{saving=false;$('#checkin-session').disabled=false;panel.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 $('#back-sign').onclick=()=>{if(confirm('返回後，尚未儲存的姓名與簽名會清除，確定返回？'))close();};
 if(!onsite)$('#undo-sign').onclick=async()=>{if(!confirm('確定復原報到？已儲存的姓名與簽名會一併刪除。'))return;try{await api(`/api/admin/checkins/${encodeURIComponent(r.registration_id)}/undo`,{method:'POST',body:{}});close();await refresh();}catch(e){$('#sign-error').textContent=e.message;}};
 panel.scrollIntoView({block:'start'});
 }
 function onsiteTools(){
 const box=$('#onsite-tools');if(!me.permissions.includes('registrations'))return;
 const s=sessions.find(s=>s.id===sid);box.innerHTML=`<section class="panel"><h3>現場直接報名</h3><p>未報名者可在本裝置填表、簽名，完成報名與簽到。限活動當天、結束前及有剩餘名額時受理。</p><div class="editor-actions"><button type="button" class="button secondary" id="toggle-onsite">${s.onsite_open?'關閉現場報名':'開放現場報名'}</button>${s.onsite_open?'<button type="button" class="button" id="new-onsite">填寫現場報名表</button>':''}</div></section>`;
 $('#toggle-onsite').onclick=async e=>{e.target.disabled=true;try{await api('/api/admin/checkins/onsite',{method:'PATCH',body:{session_id:sid,enabled:!s.onsite_open}});s.onsite_open=s.onsite_open?0:1;onsiteTools();}catch(error){toast(error.message);e.target.disabled=false;}};
 $('#new-onsite')?.addEventListener('click',async()=>{try{const data=await api(`/api/admin/checkins/onsite?session_id=${encodeURIComponent(sid)}`);editor({people:[],seats:100,nickname:'',fee_snapshot:data.session.fee,status:'confirmed'},data);}catch(e){toast(e.message);}});
 }
 onsiteTools();
 $('#lookup-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter,version=revision;button.disabled=true;try{const rows=await api('/api/admin/checkins/search',{method:'POST',body:{session_id:sid,query:$('#lookup-name').value}});if(disposed||version!==revision)return;$('#lookup-results').innerHTML=rows.length?`<ul class="checkin-list">${rows.map(r=>`<li><span>${esc(r.name)} · ${r.seats} 位 · ${r.status==='pending'?'待確認':'已確認'}</span><button class="button" data-code="${esc(r.code)}">${r.checked_in_at?'修改簽到':'選取並報到'}</button></li>`).join('')}</ul><p class="help">同名時請工作人員核對人數與報名資料後再選取。</p>`:'<p>找不到可報到的報名，請確認姓名或洽工作人員。</p>';$('#lookup-results').querySelectorAll('button').forEach(b=>b.onclick=()=>open(b.dataset.code));}catch(e){toast(e.message);}finally{button.disabled=false;}};
 $('#checkin-session').onchange=async e=>{if(!panel.hidden&&!confirm('切換場次會清除尚未儲存的簽名，確定切換？')){e.target.value=sid;return;}sid=e.target.value;revision++;close();onsiteTools();$('#lookup-results').innerHTML='';$('#lookup-name').value='';await refresh();};
 $('#print-sheet')?.addEventListener('click',()=>window.open(`/admin/checkin-sheet.html#${encodeURIComponent(sid)}`,'_blank','noopener'));
 await refresh();return ()=>{disposed=true;revision++;};
}
