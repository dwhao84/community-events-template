import {api,esc,dateLabel,toast} from '../shared.js';
// Admin course feedback. Client routes: /admin/feedback, /create, /:id/edit, /:id/email, /:id/results.
const statusText={draft:'草稿',published:'收集中',closed:'已關閉'};
const mailText={pending:'等待寄送',processing:'寄送中',accepted:'寄信服務已接受',delivered:'已送達',bounced:'退信',failed:'寄送失敗',cancelled:'未寄出（資格不符）',unknown:'結果不明'};
const regText={pending:'待確認',confirmed:'已確認',waitlisted:'候補',cancelled:'已取消'};
const tabs=[['edit','基本資訊與預覽'],['email','寄送與紀錄'],['results','統計與答案']];
const time=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const day=v=>v?new Date(v).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}):'—';
const pill=s=>`<span class="pill fb-status is-${esc(s)}">${esc(statusText[s]||s)}</span>`;
const widths=root=>{for(const el of root.querySelectorAll('[data-w]'))el.style.width=`${Math.max(0,Math.min(100,Number(el.dataset.w)))}%`;};

export async function feedbackPage(content,me,{confirmAction,busy}){
 let disposed=false,draft=null;
 const go=(path,replace=false)=>{history[replace?'replaceState':'pushState'](null,'',path);route();};
 const pop=()=>location.pathname.startsWith('/admin/feedback')?route():location.reload();window.addEventListener('popstate',pop);
 const bindGo=root=>{for(const el of root.querySelectorAll('[data-go]'))el.onclick=ev=>{ev.preventDefault();go(el.dataset.go);};};
 async function route(){
  if(disposed)return;const p=location.pathname.split('/').filter(Boolean),[, ,id,tab]=p;
  content.innerHTML='<p class="loading">載入中…</p>';
  try{if(!id)await list();else if(id==='create')await create();else await detail(id,tabs.some(([k])=>k===tab)?tab:'edit');}
  catch(e){if(!disposed)content.innerHTML=`<div class="panel"><p class="error">${esc(e.message)}</p><button class="button secondary" data-go="/admin/feedback">回到回饋表列表</button></div>`;bindGo(content);}
 }
 async function list(){
  const {forms,events}=await api('/api/admin/feedback');
  const wanted=new URLSearchParams(location.search).get('event');
  if(wanted){const f=forms.find(x=>x.event_id===wanted);return go(f?`/admin/feedback/${f.id}/edit`:`/admin/feedback/create?event=${encodeURIComponent(wanted)}`,true);}
  const free=events.filter(e=>!e.has_form).length;
  content.innerHTML=`<div class="notice">每個活動可建立一份固定八題的課程回饋表。學員透過 Email 中的專屬連結填寫；後台答案不顯示姓名與 Email。</div><div class="toolbar"><span>${forms.length} 份回饋表</span><button class="button" data-go="/admin/feedback/create" ${free?'':'disabled'}>建立回饋表</button></div>${forms.length?`<div class="table-wrap"><table><thead><tr><th>課程名稱</th><th>日期</th><th>狀態</th><th>已寄送</th><th>回覆數</th><th>平均滿意度</th><th></th></tr></thead><tbody>${forms.map(f=>`<tr><td data-label="課程名稱"><span class="cell-stack"><span class="fb-wrap">${esc(f.event_title)}</span><small class="cell-sub fb-wrap">${esc(f.title)}</small></span></td><td data-label="日期">${f.starts_at?esc(dateLabel(f.starts_at)):'—'}</td><td data-label="狀態">${pill(f.status)}</td><td data-label="已寄送">${f.sent} 人</td><td data-label="回覆數">${f.responses} 份</td><td data-label="平均滿意度">${esc(f.overall_display)}</td><td class="cell-actions"><button data-go="/admin/feedback/${esc(f.id)}/results">結果</button><button data-go="/admin/feedback/${esc(f.id)}/edit">管理</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty panel"><strong>尚未建立回饋表</strong><p>按「建立回饋表」並選擇活動即可開始。</p></div>'}`;
  bindGo(content);
 }
 async function create(){
  const data=await api('/api/admin/feedback'),{events}=data;questions=data.questions||[];const free=events.filter(e=>!e.has_form),wanted=new URLSearchParams(location.search).get('event');
  const head='<div class="fb-head"><button class="fb-back" data-go="/admin/feedback">← 回饋表列表</button><h2>建立課程回饋表</h2></div>';
  if(!free.length){content.innerHTML=`${head}<div class="panel"><p>所有活動都已建立回饋表，或目前沒有可用的活動。</p></div>`;bindGo(content);return;}
  content.innerHTML=`${head}<form class="panel" id="fb-create"><div class="form-field"><label for="fb-event">選擇活動</label><select id="fb-event" name="event" required>${free.map(e=>`<option value="${esc(e.id)}" ${e.id===wanted?'selected':''}>${esc(e.title)}${e.starts_at?` · ${esc(dateLabel(e.starts_at))}`:''}</option>`).join('')}</select><p class="help">課程名稱、日期、地點、報名與簽到資料會自動帶入；每個活動僅能建立一份。建立後為草稿，只有管理員可預覽。</p></div><p class="error" id="fb-error"></p><div class="editor-actions"><button class="button">建立草稿</button><button class="button secondary" type="button" data-go="/admin/feedback">取消</button></div></form><section class="panel"><h3>固定題目範本（第 1 版）</h3>${questionList()}</section>`;
  bindGo(content);
  content.querySelector('#fb-create').onsubmit=async ev=>{ev.preventDefault();await busy(ev.submitter||ev.target.querySelector('button'),async()=>{try{const r=await api('/api/admin/feedback',{method:'POST',body:{event_id:ev.target.event.value}});toast('回饋表草稿已建立');go(`/admin/feedback/${r.id}/edit`,true);}catch(e){content.querySelector('#fb-error').textContent=e.message;}});};
 }
 let questions=[];
 const questionList=()=>`<ol class="fb-questions">${(questions.length?questions:[]).map(q=>`<li><strong>${esc(q.no)}</strong> ${esc(q.label)} <small>${q.type==='rating'?'1–5 星':q.type==='choice'?'單選':'多行文字'} · ${q.required?'必填':'選填'}</small>${q.options?`<small class="fb-options">${q.options.map(o=>esc(o[1])).join('／')}</small>`:''}</li>`).join('')||'<li>八題固定題目：Q1–Q5 星級評分、Q6 難易度、Q7 再次參加意願、Q8 其他建議（選填）。</li>'}</ol>`;
 async function detail(id,tab){
  const d=await api(`/api/admin/feedback/${encodeURIComponent(id)}`);if(disposed)return;questions=d.questions;const f=d.form;
  content.innerHTML=`<div class="fb-head"><button class="fb-back" data-go="/admin/feedback">← 回饋表列表</button><div class="fb-title"><h2>${esc(d.course.title)}</h2>${pill(f.status)}</div></div><nav class="fb-tabs" aria-label="回饋表分頁">${tabs.map(([k,l])=>`<button data-go="/admin/feedback/${esc(id)}/${k}" ${k===tab?'aria-current="page" class="active"':''}>${l}</button>`).join('')}</nav><div id="fb-tab"><p class="loading">載入中…</p></div>`;
  bindGo(content);const box=content.querySelector('#fb-tab');
  await ({edit:editTab,email:emailTab,results:resultsTab}[tab])(box,d);
 }
 function editTab(box,d){
  const f=d.form,c=d.course,n=c.counts;
  box.innerHTML=`<div class="fb-grid"><section class="panel"><h3>課程資訊（自動帶入）</h3><dl class="fb-facts"><div><dt>活動編號</dt><dd>${esc(c.event_id)}</dd></div><div><dt>活動名稱</dt><dd>${esc(c.title)}</dd></div><div><dt>場次</dt><dd>${c.sessions.map(s=>`${esc(dateLabel(s.starts_at))} ${esc(new Date(s.starts_at).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}))} · ${esc(s.location)}${s.status==='cancelled'?'（已取消）':''}`).join('<br>')||'尚無場次'}</dd></div><div><dt>報名</dt><dd>有效 ${n.valid} 筆 · 候補 ${n.waitlisted} · 取消 ${n.cancelled}</dd></div><div><dt>已簽到</dt><dd>${n.attended} 筆</dd></div></dl></section>
  <section class="panel"><h3>填寫狀態</h3><p>目前：${pill(f.status)}　${f.status==='draft'?'草稿只有管理員可預覽，學員連結會顯示「尚未開放」。':f.status==='published'?'有效邀請可填寫；關閉後停止提交，保留既有回覆。':'已停止提交；可重新開放，已使用的連結與既有回覆不會重置。'}</p><div class="editor-actions">${f.status==='published'?'<button class="button danger" id="fb-close">關閉填寫</button>':`<button class="button" id="fb-publish">${f.status==='closed'?'重新開放填寫':'開放填寫'}</button>`}<button class="button secondary" id="fb-preview">預覽學員頁面</button></div><p class="help">預覽會開新分頁並使用 24 小時有效的測試連結；送出不會產生正式回覆。</p></section></div>
  <form class="panel" id="fb-info"><h3>表單基本資訊</h3><div class="form-field"><label for="fb-title">標題</label><input id="fb-title" name="title" maxlength="200" value="${esc(f.title)}" required></div><div class="form-field"><label for="fb-desc">填寫說明</label><textarea id="fb-desc" name="description" maxlength="2000" rows="4">${esc(f.description)}</textarea></div><p class="error" id="fb-error"></p><div class="editor-actions"><button class="button">儲存基本資訊</button></div></form>
  <section class="panel"><h3>固定題目（範本第 ${f.template_version} 版，不可編輯）</h3>${questionList()}</section>`;
  const reload=()=>detail(f.id,'edit');
  box.querySelector('#fb-info').onsubmit=async ev=>{ev.preventDefault();await busy(ev.target.querySelector('button'),async()=>{try{await api(`/api/admin/feedback/${f.id}`,{method:'PATCH',body:{title:ev.target.title.value,description:ev.target.description.value}});toast('基本資訊已儲存');await reload();}catch(e){box.querySelector('#fb-error').textContent=e.message;}});};
  const status=async(b,action,cfg)=>{if(!await confirmAction(cfg))return;await busy(b,async()=>{try{await api(`/api/admin/feedback/${f.id}/${action}`,{method:'POST',body:{}});toast(action==='close'?'已關閉填寫':'已開放填寫');await reload();}catch(e){toast(e.message);}});};
  const pub=box.querySelector('#fb-publish'),close=box.querySelector('#fb-close');
  if(pub)pub.onclick=()=>status(pub,'publish',{title:f.status==='closed'?'重新開放填寫？':'開放填寫？',action:f.status==='closed'?'重新開放':'開放填寫',body:`<p>開放後，持有有效邀請連結的學員即可提交回饋。${f.status==='closed'?'已使用的連結不會重新啟用，既有回覆保留。':''}</p><p>開放不會自動寄信；正式寄送須在「寄送與紀錄」另行確認。</p>`});
  if(close)close.onclick=()=>status(close,'close',{title:'關閉填寫？',action:'關閉填寫',danger:true,body:'<p>關閉後學員將無法提交，既有回覆與寄送紀錄完整保留；之後可重新開放。</p>'});
  box.querySelector('#fb-preview').onclick=async ev=>{const w=window.open('about:blank','_blank');try{const r=await api(`/api/admin/feedback/${f.id}/preview`,{method:'POST',body:{}});if(w){w.opener=null;w.location.replace(r.url);}else location.assign(r.url);}catch(e){w?.close();toast(e.message);}};
 }
 async function emailTab(box,d){
  const f=d.form;draft=null;
  box.innerHTML=`${f.status==='published'?'':`<div class="notice">表單${f.status==='draft'?'尚未開放':'已關閉'}：可預覽名單與寄送測試信，正式寄送須先開放填寫。</div>`}
  <section class="panel"><h3>1. 選擇收件對象</h3><fieldset class="fb-modes"><legend class="visually-hidden">收件對象</legend>${Object.entries(d.modes).map(([k,l],i)=>`<label class="choice"><input type="radio" name="fb-mode" value="${k}" ${i?'':'checked'}>${esc(l)}${k==='registered'?'（預設）':''}</label>`).join('')}</fieldset><p class="help">取消報名、候補、無有效 Email、已完成填寫者會自動排除並列出原因。提醒僅寄給已成功寄出邀請、尚未填寫的有效受邀者，不會自動寄送。</p><div class="editor-actions"><button class="button" id="fb-load">預覽名單與信件</button></div></section>
  <div id="fb-preview-box"></div>
  <section class="panel"><h3>寄送測試信</h3><p>測試信使用獨立的預覽連結，送出不會儲存回覆，也不列入正式統計或消耗正式邀請。</p><form id="fb-test" class="fb-inline"><div class="form-field"><label for="fb-test-email">測試收件 Email（管理員）</label><input id="fb-test-email" type="email" name="email" value="${esc(me.email)}" required autocomplete="email"></div><button class="button secondary">寄送測試信</button></form><p class="error" id="fb-test-error"></p></section>
  <section class="panel"><div class="toolbar"><h3>邀請與寄送紀錄</h3><button class="button secondary" id="fb-refresh">重新整理</button></div><div id="fb-invites"><p class="loading">載入中…</p></div><p class="help">「寄信服務已接受」代表寄信服務收件，不等於已讀或送達。答案不會與此名單並列顯示。</p></section>`;
  const mode=()=>box.querySelector('[name=fb-mode]:checked').value;
  box.querySelector('#fb-load').onclick=ev=>busy(ev.target,()=>loadPreview(box,f,mode()));
  for(const r of box.querySelectorAll('[name=fb-mode]'))r.onchange=()=>{draft=null;box.querySelector('#fb-preview-box').innerHTML='';};
  box.querySelector('#fb-test').onsubmit=async ev=>{ev.preventDefault();const err=box.querySelector('#fb-test-error');err.textContent='';await busy(ev.target.querySelector('button'),async()=>{try{const r=await api(`/api/admin/feedback/${f.id}/email/test`,{method:'POST',body:{email:ev.target.email.value,kind:mode()==='reminder'?'reminder':'invite'}});toast(`測試信：${mailText[r.status]||r.status}${r.status==='pending'?'（將由排程寄出）':''}`);if(r.error)err.textContent=`寄送結果：${r.error}`;}catch(e){err.textContent=e.message;}});};
  box.querySelector('#fb-refresh').onclick=()=>invites(box,f);
  await invites(box,f);
 }
 async function loadPreview(box,f,mode){
  const p=await api(`/api/admin/feedback/${f.id}/email/preview`,{method:'POST',body:{mode}});draft={...p,operation_id:crypto.randomUUID()};
  const out=box.querySelector('#fb-preview-box'),people=rows=>rows.map(r=>`<tr><td data-label="報名編號">${esc(r.code)}</td><td data-label="姓名">${esc(r.name||'—')}</td><td data-label="Email">${esc(r.email)}</td><td data-label="場次"><span class="fb-wrap">${esc(r.session)}</span></td><td data-label="${r.reason?'排除原因':'簽到'}">${r.reason?esc(r.reason):r.checked_in?'已簽到':'—'}</td></tr>`).join('');
  out.innerHTML=`<section class="panel"><h3>2. 確認名單與信件（${esc(p.mode_label)}）</h3><div class="stats fb-mini"><div class="stat"><strong>${p.count}</strong><span>將寄送人數</span></div><div class="stat"><strong>${p.excluded.length}</strong><span>排除人數</span></div><div class="stat"><strong>${p.retryable.length}</strong><span>可重試的失敗寄送</span></div></div>
  ${p.excluded_summary.length?`<p><strong>排除原因：</strong>${p.excluded_summary.map(x=>`${esc(x.reason)} ${x.count} 筆`).join('、')}</p>`:''}
  ${p.duplicates.length?`<div class="notice">同一 Email 有多筆不同場次的報名，將依報名紀錄各寄一份邀請，不會合併：${p.duplicates.map(x=>`${esc(x.email)}（${x.count} 筆）`).join('、')}</div>`:''}
  <details class="fb-details" ${p.count&&p.count<=30?'open':''}><summary>收件名單（${p.count}）</summary>${p.count?`<div class="table-wrap"><table><thead><tr><th>報名編號</th><th>姓名</th><th>Email</th><th>場次</th><th>簽到</th></tr></thead><tbody>${people(p.recipients)}</tbody></table></div>`:'<p class="empty">沒有符合條件的收件者。</p>'}</details>
  ${p.excluded.length?`<details class="fb-details"><summary>排除名單（${p.excluded.length}）</summary><div class="table-wrap"><table><thead><tr><th>報名編號</th><th>姓名</th><th>Email</th><th>場次</th><th>排除原因</th></tr></thead><tbody>${people(p.excluded)}</tbody></table></div></details>`:''}
  <h3 class="section-gap">信件內容預覽</h3><div class="fb-mail"><p><strong>主旨：</strong>${esc(p.message.subject)}</p><pre>${esc(p.message.text)}</pre></div><p class="help">實際寄出的 HTML 版本內容相同，另附「填寫課程回饋表」按鈕；課程日期與地點依每位收件者的報名場次帶入，連結為個人專屬。</p>
  <div class="editor-actions"><button class="button" id="fb-send" ${p.can_send?'':'disabled'}>${mode==='reminder'?'寄送提醒信':'正式寄送邀請'}（${p.count} 人）</button>${p.retryable.length&&f.status==='published'?`<button class="button secondary" id="fb-retry">重試失敗寄送（${p.retryable.length}）</button>`:''}</div>${p.can_send?'':`<p class="help">${f.status!=='published'?'表單開放填寫後才能正式寄送。':'目前沒有可寄送的收件者。'}</p>`}</section>`;
  const send=out.querySelector('#fb-send'),retry=out.querySelector('#fb-retry');
  if(send)send.onclick=async()=>{if(!await confirmAction({title:mode==='reminder'?'確認寄送提醒信？':'確認正式寄送回饋邀請？',action:`確認寄送 ${p.count} 封`,body:`<p>活動：<strong>${esc(f.event_title)}</strong></p><p>收件對象：${esc(p.mode_label)}，共 <strong>${p.count} 人</strong>${p.excluded.length?`（已排除 ${p.excluded.length} 人）`:''}。</p><p>主旨：${esc(p.message.subject)}</p><p>信件寄出後無法收回；重複點擊不會重複寄送。</p>`}))return;
   await busy(send,async()=>{try{const r=await api(`/api/admin/feedback/${f.id}/email/${mode==='reminder'?'remind':'send'}`,{method:'POST',body:{mode,confirm:true,operation_id:draft.operation_id,expected_count:p.count}});toast(r.repeated?'此批次先前已送出，未重複寄送':`已排入 ${r.queued} 封，立即處理 ${r.processed} 封；其餘由排程寄出`);await loadPreview(box,f,mode);await invites(box,f);}catch(e){toast(e.message);if(e.details?.reload)await loadPreview(box,f,mode);}});};
  if(retry)retry.onclick=async()=>{if(!await confirmAction({title:'重試失敗寄送？',action:`重試 ${p.retryable.length} 封`,body:`<p>將對先前寄送失敗或退信、尚未成功寄出的 ${p.retryable.length} 位受邀者重新寄送原邀請連結。重試前請確認 Email 是否正確。</p>`}))return;
   await busy(retry,async()=>{try{const r=await api(`/api/admin/feedback/${f.id}/email/retry`,{method:'POST',body:{confirm:true,operation_id:crypto.randomUUID()}});toast(`已重試 ${r.queued} 封`);await loadPreview(box,f,mode);await invites(box,f);}catch(e){toast(e.message);}});};
 }
 async function invites(box,f){
  const el=box.querySelector('#fb-invites');try{const rows=await api(`/api/admin/feedback/${f.id}/invitations`);if(disposed)return;
   el.innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>報名編號</th><th>姓名</th><th>Email</th><th>場次</th><th>寄送</th><th>填寫</th></tr></thead><tbody>${rows.map(r=>`<tr><td data-label="報名編號">${esc(r.code)}</td><td data-label="姓名">${esc(r.name||'—')}</td><td data-label="Email">${esc(r.email)}</td><td data-label="場次"><span class="fb-wrap">${esc(r.session)}</span></td><td data-label="寄送"><span class="cell-stack"><span>${r.sent_at?'已寄出':esc(mailText[r.last_status]||'尚未寄送')}</span><small class="cell-sub">${r.sent_at?`首次 ${esc(time(r.sent_at))}`:''}${r.last_kind==='feedback_reminder'?' · 最近為提醒':''}${r.last_status&&r.sent_at&&r.last_status!=='accepted'?` · 最近：${esc(mailText[r.last_status]||r.last_status)}`:''}${r.last_error?` · ${esc(r.last_error)}`:''}</small></span></td><td data-label="填寫">${r.completed?'<span class="pill">已完成</span>':r.expired?'已過期':regText[r.status]&&r.status==='cancelled'?'已取消報名':'尚未填寫'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">尚未寄出任何正式邀請。</p>';
  }catch(e){el.innerHTML=`<p class="error">${esc(e.message)}</p>`;}
 }
 async function resultsTab(box,d){
  const f=d.form,[r,responses]=await Promise.all([api(`/api/admin/feedback/${f.id}/results`),api(`/api/admin/feedback/${f.id}/responses`)]);if(disposed)return;
  const k=r.kpi,labels=d.rating_labels,ratings=d.questions.filter(q=>q.type==='rating');
  const card=(v,l,sub='')=>`<div class="stat"><strong>${esc(v)}</strong><span>${esc(l)}</span>${sub?`<small class="cell-sub">${esc(sub)}</small>`:''}</div>`;
  const bars=(rows,total)=>`<ul class="fb-dist">${rows.map(([l,c])=>`<li><span class="fb-dist-label">${esc(l)}</span><span class="fb-bar" aria-hidden="true"><i data-w="${total?c/total*100:0}"></i></span><span class="fb-dist-count">${c}</span></li>`).join('')}</ul>`;
  box.innerHTML=`<div class="toolbar"><span>共 ${r.responses} 份回覆（不含測試）</span>${me.permissions.includes('export')?'<button class="button secondary" id="fb-export">匯出 CSV</button>':''}</div>
  <div class="stats fb-kpis">${card(k.registrations,'有效報名人數','待確認＋已確認報名筆數')}${card(k.attended,'出席人數','已簽到報名筆數')}${card(k.sent,'已寄送人數','至少一次寄送成功')}${card(k.failed,'寄送失敗人數')}${card(k.completed,'已填寫人數')}${card(k.not_completed,'尚未填寫人數')}${card(r.display.response_rate,'回覆率')}${card(r.display.overall_rating,'整體滿意度','Q1 平均（1–5）')}</div>
  ${r.responses?`<div class="fb-grid"><section class="panel"><h3>各項滿意度</h3>${ratings.map(q=>`<div class="fb-rating"><p><strong>${esc(q.no)} ${esc(q.short)}</strong><span class="fb-avg">平均 ${esc(r.display[q.id])}</span></p>${bars([5,4,3,2,1].map(n=>[`${n} ${labels[n-1]}`,r.distribution[q.id][n-1]]),r.responses)}</div>`).join('')}</section>
  <section class="panel"><h3>Q6 難易度</h3>${bars(r.distribution.difficulty.map(x=>[x.label,x.count]),r.responses)}<h3 class="section-gap">Q7 再次參加意願</h3>${bars(r.distribution.attend_again.map(x=>[x.label,x.count]),r.responses)}</section></div>
  <section class="panel"><h3>Q8 文字建議（${r.comments.length}）</h3>${r.comments.length?`<ul class="fb-comments">${r.comments.map(c=>`<li><p>${esc(c.comment)}</p><small>${esc(day(c.submitted_at))}</small></li>`).join('')}</ul>`:'<p class="empty">尚無文字建議。</p>'}</section>
  <section class="panel"><h3>答案列表</h3><p class="help">答案列表不顯示姓名與 Email，也不提供依個人查詢。</p><div class="table-wrap"><table><thead><tr><th>回覆 ID</th><th>提交時間</th>${d.questions.slice(0,7).map(q=>`<th title="${esc(q.label)}">${esc(q.no)}</th>`).join('')}</tr></thead><tbody>${responses.map(x=>`<tr><td data-label="回覆 ID">${esc(x.id.slice(0,8))}</td><td data-label="提交時間">${esc(time(x.submitted_at))}</td>${ratings.map(q=>`<td data-label="${esc(q.no)} ${esc(q.short)}">${x[q.id]}</td>`).join('')}<td data-label="Q6 難易度">${esc(x.difficulty_label)}</td><td data-label="Q7 再次參加">${esc(x.attend_again_label)}</td></tr>`).join('')}</tbody></table></div></section>`:'<div class="empty panel"><strong>尚無回覆</strong><p>寄出邀請且學員提交後，統計會顯示在這裡；平均分在沒有有效評分時顯示「—」。</p></div>'}`;
  widths(box);
  const ex=box.querySelector('#fb-export');if(ex)ex.onclick=()=>busy(ex,async()=>{try{const res=await api(`/api/admin/feedback/${f.id}/export`);const url=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=url;a.download=`course-feedback-${f.event_id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}});
 }
 await route();
 return ()=>{disposed=true;window.removeEventListener('popstate',pop);if(location.pathname.startsWith('/admin/feedback'))history.replaceState(null,'','/admin/');};
}
