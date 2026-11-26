export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const statusLabel=s=>({pending:'待確認',confirmed:'已確認',waitlisted:'候補',cancelled:'已取消',processing:'處理中',accepted:'供應商已接受',delivered:'已送達',bounced:'退信',failed:'失敗',unknown:'結果不明',published:'已發布',draft:'草稿',hidden:'隱藏',removed:'已移除'})[s]||s;
export const dateLabel=v=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',weekday:'short',year:'numeric'}).format(new Date(v));
export async function api(path,{method='GET',body,headers={}}={}) {
 const token=sessionStorage.getItem('local_admin_token');if(token)headers.Authorization='Bearer '+token;
 if(body!==undefined&&!(body instanceof Blob)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
 const r=await fetch(path,{method,body,headers,credentials:'same-origin'});if(!r.ok){let b;try{b=await r.json();}catch{b={error:'服務暫時無法處理'};}const e=Error(b.error);e.details=b.details;e.status=r.status;throw e;}
 if(r.headers.get('content-type')?.includes('application/json'))return r.json();return r;
}
export function fieldMarkup(f,value){
 const label=esc(f.label)+(f.required?' <span class="required" aria-label="必填">*</span>':'');const id='field-'+f.id;const attrs=`id="${esc(id)}" name="${esc(f.id)}" ${f.required?'required':''} aria-describedby="help-${esc(f.id)} error-${esc(f.id)}"`;let input;
 if(['select','radio','checkboxes'].includes(f.type)){
  const safe=(f.type==='checkboxes'?Array.isArray(value)&&value.every(v=>f.options.includes(v)):value===undefined||f.options.includes(String(value)))?value:undefined;
  if(f.type==='select')input=`<select ${attrs}><option value="">請選擇</option>${f.options.map(o=>`<option value="${esc(o)}" ${String(safe)===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  else input=`<fieldset><legend>${label}</legend>${f.options.map((o,i)=>`<label class="choice"><input type="${f.type==='radio'?'radio':'checkbox'}" name="${esc(f.id)}" value="${esc(o)}" ${f.type==='radio'&&f.required?'required':''} ${f.type==='radio'?String(safe)===o?'checked':'':Array.isArray(safe)&&safe.includes(o)?'checked':''}>${esc(o)}</label>`).join('')}</fieldset>`;
 }else if(f.type==='textarea')input=`<textarea ${attrs} maxlength="${f.maxLength||4000}" placeholder="${esc(f.placeholder||'')}">${esc(typeof value==='string'?value:'')}</textarea>`;
 else if(f.type==='checkbox')input=`<label class="choice"><input type="checkbox" ${attrs} ${value===true?'checked':''}>${esc(f.placeholder||'確認')}</label>`;
 else input=`<input ${attrs} type="${f.id==='email'?'email':f.type==='number'?'number':f.type==='date'?'date':'text'}" ${f.type==='number'?'step="any"':''} ${f.min!==undefined?`min="${f.min}"`:''} ${f.max!==undefined?`max="${f.max}"`:''} maxlength="${f.maxLength||4000}" placeholder="${esc(f.placeholder||'')}" value="${esc(typeof value==='string'||typeof value==='number'?value:'')}" ${f.id==='email'?'autocomplete="email"':f.id==='name'?'autocomplete="name"':''}>`;
 return `<div class="form-field">${['radio','checkboxes'].includes(f.type)?'':`<label for="${esc(id)}">${label}</label>`}${input}<p class="help" id="help-${esc(f.id)}">${esc(f.help||'')}</p><p class="field-error error" data-error="${esc(f.id)}" id="error-${esc(f.id)}"></p></div>`;
}
export function readAnswers(form,fields){const fd=new FormData(form),out={};for(const f of fields.filter(f=>f.enabled)){if(f.type==='checkboxes')out[f.id]=fd.getAll(f.id);else if(f.type==='checkbox')out[f.id]=fd.has(f.id);else if(f.type==='number')out[f.id]=fd.get(f.id)===''?'':Number(fd.get(f.id));else out[f.id]=fd.get(f.id)||'';}return out;}
let timer;export function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('visible'),4000);}
// "加入行事曆": .ics download (iPhone / Outlook / most apps) plus a Google Calendar link. No personal data in either.
const calStamp=v=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export function googleCalendarURL(s,title){const q=new URLSearchParams({action:'TEMPLATE',text:title||'',dates:`${calStamp(s.starts_at)}/${calStamp(s.ends_at)}`,details:[s.fee?`費用：${s.fee}`:'',`活動資訊：${location.origin}/`].filter(Boolean).join('\n'),location:s.location||'',ctz:'Asia/Taipei'});return 'https://calendar.google.com/calendar/render?'+q.toString();}
export function calendarMenu(s,title){
 if(!s?.id||s.status==='cancelled'||Date.parse(s.ends_at)<Date.now())return '';
 return `<details class="calendar-menu"><summary>加入行事曆</summary><div class="calendar-options"><a href="/api/sessions/${encodeURIComponent(s.id)}/calendar.ics" download>iPhone／Outlook（下載 .ics）</a><a href="${esc(googleCalendarURL(s,title))}" target="_blank" rel="noopener noreferrer">Google 日曆 ↗</a></div></details>`;
}
export function feeBadge(s){const t=s?.fee_type||(s?.fee==='免費'?'free':s?.fee==='待定'||!s?.fee?'tbd':'paid');return `<span class="fee-badge fee-${t}">${t==='free'?'免費':t==='paid'?'收費':'費用待定'}</span>`;}
