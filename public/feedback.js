import "./site.js";
import {esc} from './shared.js';
// The personal token is moved from the URL into sessionStorage, then sent only as a request header.
const root=document.querySelector('#feedback-root');
const parts=location.pathname.split('/').filter(Boolean),slug=parts[1]||'',key='feedback-token:'+slug;
const params=new URLSearchParams(location.search);
let token=params.get('token')||'';
try{if(token)sessionStorage.setItem(key,token);else token=sessionStorage.getItem(key)||'';if(params.has('token'))history.replaceState(null,'',`/feedback/${encodeURIComponent(slug)}`);}catch{}
const thanks='感謝您的寶貴意見，期待未來與您再次一起學習。';
const submissionId=crypto.randomUUID();let busy=false,preview=false;

function card(title,body,tone='info'){root.innerHTML=`<section class="feedback-card feedback-state is-${tone}"><p class="eyebrow">COURSE FEEDBACK</p><h1 tabindex="-1">${esc(title)}</h1>${body}<p><a class="button secondary" href="/">回首頁</a></p></section>`;root.querySelector('h1').focus();}
function done(message,previewNote){
 try{sessionStorage.removeItem(key);}catch{}
 if(!previewNote)history.replaceState(null,'',`/feedback/${encodeURIComponent(slug)}/success`);
 card('已收到您的回饋',`<p class="feedback-lead">${esc(message||thanks)}</p>${previewNote?`<p class="feedback-preview-note">${esc(previewNote)}</p>`:''}`,'success');
}
async function call(path,body){
 const r=await fetch(path,{method:body?'POST':'GET',headers:{'X-Feedback-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer'});
 let data;try{data=await r.json();}catch{data={error:'服務暫時無法處理，請稍後再試'};}
 if(!r.ok){const e=Error(data.error||'服務暫時無法處理');e.status=r.status;e.details=data.details||{};throw e;}return data;
}
const required=q=>q.filter(x=>x.required);
function question(q,labels){
 const err=`<p class="field-error error" id="error-${q.id}"></p>`,head=`<span class="q-no">${esc(q.no)}</span>${esc(q.label)}${q.required?' <span class="required">*<span class="visually-hidden">必填</span></span>':' <span class="optional">（選填）</span>'}`;
 if(q.type==='text')return `<div class="feedback-question" id="q-${q.id}"><label for="input-${q.id}">${head}</label><textarea id="input-${q.id}" name="${q.id}" maxlength="${q.maxLength}" rows="5" aria-describedby="help-${q.id} count-${q.id} error-${q.id}"></textarea><p class="help" id="help-${q.id}">${esc(q.help||'')}</p><p class="feedback-count" id="count-${q.id}" aria-live="polite">0 / ${q.maxLength.toLocaleString('en-US')} 字</p>${err}</div>`;
 const options=q.type==='rating'?labels.map((l,i)=>[String(i+1),l]):q.options;
 return `<fieldset class="feedback-question ${q.type==='rating'?'is-rating':'is-choice'}" id="q-${q.id}" aria-describedby="error-${q.id}"><legend>${head}</legend><div class="${q.type==='rating'?'rating':'choices'}">${options.map(([v,l])=>`<label class="${q.type==='rating'?'rating-option':'choice-option'}"><input type="radio" name="${q.id}" value="${esc(v)}" required>${q.type==='rating'?`<span class="star" aria-hidden="true">★</span><span class="rating-text"><b>${esc(v)}</b>${esc(l)}</span>`:`<span>${esc(l)}</span>`}</label>`).join('')}</div>${err}</fieldset>`;
}
function read(form,questions){const fd=new FormData(form),a={};for(const q of questions){const v=fd.get(q.id);a[q.id]=q.type==='rating'?(v?Number(v):null):q.type==='text'?String(v||''):(v||null);}return a;}
function render(data){
 const {form,course,questions,rating_labels:labels}=data,need=required(questions);preview=data.preview;
 root.innerHTML=`${preview?'<p class="feedback-banner" role="note">預覽模式：此為管理員測試連結，送出不會儲存回覆，也不計入統計。</p>':''}<section class="feedback-card feedback-intro"><p class="eyebrow">COURSE FEEDBACK</p><h1>${esc(form.title)}</h1><dl class="feedback-course"><div><dt>課程名稱</dt><dd>${esc(course.title)}</dd></div>${course.date?`<div><dt>課程日期</dt><dd>${esc(course.date)}</dd></div>`:''}${course.location?`<div><dt>課程地點</dt><dd>${esc(course.location)}</dd></div>`:''}</dl>${form.description?`<p class="feedback-lead">${esc(form.description)}</p>`:''}<p class="feedback-meta">填寫約 1～2 分鐘 · 共 ${questions.length} 題，其中 ${need.length} 題必填（標示 <span class="required">*</span>）</p><details class="feedback-privacy"><summary>隱私說明</summary><p>回饋內容僅供課程規劃及品質改善使用。後台的答案列表不顯示您的姓名或 Email；但因寄送紀錄與填寫時間仍可能間接辨識，本問卷並非完全匿名。請勿在建議欄填寫電話、身分證字號等個人敏感資訊。此為您的專屬連結，送出後即無法再次填寫，請勿轉傳。</p></details></section>
 <form id="feedback-form" class="feedback-card" novalidate><div class="feedback-progress"><p id="progress-text" aria-live="polite">已完成 0 / ${need.length} 題必填</p><div class="feedback-bar" aria-hidden="true"><i></i></div></div>${questions.map(q=>question(q,labels)).join('')}<p class="error feedback-form-error" id="form-error" role="alert"></p><button class="button feedback-submit" type="submit">送出回饋</button></form>`;
 const f=root.querySelector('#feedback-form'),bar=f.querySelector('.feedback-bar i'),textarea=f.querySelector('textarea');
 const update=()=>{const a=read(f,questions),n=need.filter(q=>a[q.id]!==null&&a[q.id]!=='').length;f.querySelector('#progress-text').textContent=`已完成 ${n} / ${need.length} 題必填`;bar.style.width=`${n/need.length*100}%`;
  for(const fs of f.querySelectorAll('.is-rating')){const v=Number(new FormData(f).get(fs.id.slice(2))||0);fs.querySelectorAll('.rating-option').forEach((o,i)=>o.classList.toggle('filled',i<v));}
  if(textarea)f.querySelector(`#count-${textarea.name}`).textContent=`${textarea.value.length.toLocaleString('en-US')} / ${Number(textarea.maxLength).toLocaleString('en-US')} 字`;};
 f.addEventListener('input',e=>{update();const q=e.target.closest('.feedback-question');if(q){q.classList.remove('has-error');q.querySelector('.field-error').textContent='';}});
 f.onsubmit=async ev=>{
  ev.preventDefault();if(busy)return;const a=read(f,questions),errors={};
  for(const q of need)if(a[q.id]===null||a[q.id]==='')errors[q.id]='請選擇一個選項';
  if(showErrors(f,errors))return;
  const button=f.querySelector('.feedback-submit');busy=true;button.disabled=true;button.textContent='送出中…';f.querySelector('#form-error').textContent='';
  try{const r=await call(`/api/feedback/${encodeURIComponent(slug)}/submit`,{submission_id:submissionId,answers:a});done(r.preview?thanks:r.message,r.preview?r.message:null);}
  catch(e){
   if(e.status===400&&Object.keys(e.details).length)showErrors(f,e.details);
   else if(e.details?.state){const s=e.details.state;card(s==='used'?'您已完成填寫':s==='expired'?'連結已過期':'目前無法填寫',`<p class="feedback-lead">${esc(e.message)}</p>`,s==='used'?'success':'warning');return;}
   else f.querySelector('#form-error').textContent=e.status?e.message:'網路連線不穩定，您的作答仍保留在本頁，請稍後再按一次「送出回饋」。';
  }finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent='送出回饋';}}
 };
 update();
}
function showErrors(f,errors){
 const ids=Object.keys(errors);for(const id of ids){const q=f.querySelector(`#q-${CSS.escape(id)}`);if(!q)continue;q.classList.add('has-error');q.querySelector('.field-error').textContent=errors[id];}
 if(ids.length){f.querySelector('#form-error').textContent=`尚有 ${ids.length} 題需要確認，請檢查標示的題目。`;const first=f.querySelector('.has-error input,.has-error textarea');first?.focus();first?.closest('.feedback-question')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
 return ids.length>0;
}
async function start(){
 if(parts[2]==='success'&&!token){card('已收到您的回饋',`<p class="feedback-lead">${esc(thanks)}</p>`,'success');return;}
 if(!slug||!token){card('請使用專屬填寫連結','<p class="feedback-lead">請從課程回饋邀請 Email 中的「填寫課程回饋表」按鈕開啟本頁。</p>','warning');return;}
 try{const data=await call(`/api/feedback/${encodeURIComponent(slug)}`);
  if(data.state!=='open'){card(data.state==='used'?'您已完成填寫':data.state==='expired'?'連結已過期':'目前無法填寫',`<p class="feedback-lead">${esc(data.message)}</p><p class="feedback-meta">課程：${esc(data.course.title)}</p>`,data.state==='used'?'success':'warning');return;}
  render(data);
 }catch(e){card(e.status===429?'操作太頻繁':e.status?'連結無法使用':'無法連線',`<p class="feedback-lead">${esc(e.status?e.message:'網路連線不穩定，請確認網路後重新整理本頁。')}</p>`,'warning');}
}
start();
