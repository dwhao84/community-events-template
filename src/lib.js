export class HttpError extends Error { constructor(status, message, details) { super(message); this.status=status; this.details=details; } }
export const fail = (status,message,details) => { throw new HttpError(status,message,details); };
export const nowISO = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const stmt = (db,sql,...args) => db.prepare(sql).bind(...args);
export const one = (db,sql,...args) => stmt(db,sql,...args).first();
export const all = async (db,sql,...args) => (await stmt(db,sql,...args).all()).results;
export const run = (db,sql,...args) => stmt(db,sql,...args).run();
export const normalizeEmail = v => String(v || '').trim().toLowerCase();
export const emailValid = v => typeof v==='string' && v.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const text = (v,max=1000) => typeof v==='string' && v.length<=max ? v.trim() : fail(400,`文字欄位最多 ${max} 字`);
export const escapeHTML = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const statusLabel = s => ({pending:'待確認',confirmed:'已確認',waitlisted:'候補',cancelled:'已取消'})[s]||s;
export const dateLabel = value => new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'full',timeStyle:'short'}).format(new Date(value));
export function reminderAt(start,time='09:00') {
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400,'提醒時間格式錯誤');
 const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
 return new Date(new Date(`${day}T${time}:00+08:00`).getTime()-86400000).toISOString();
}
export function iso(v,nullable=false) { if(nullable && !v) return null; if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v))) fail(400,'日期須包含時區'); return new Date(v).toISOString(); }
export async function jsonBody(req,max=65536) {
 if(!(req.headers.get('content-type')||'').includes('application/json')) fail(415,'請使用 JSON');
 const raw=await readLimited(req,max); try { const b=JSON.parse(new TextDecoder().decode(raw)); if(!b||Array.isArray(b)||typeof b!=='object') throw Error(); return b; } catch { fail(400,'JSON 格式錯誤'); }
}
export async function readLimited(req,max) {
 if(Number(req.headers.get('content-length'))>max) fail(413,'檔案或資料超過上限');
 const reader=req.body?.getReader(); if(!reader) return new Uint8Array(); const chunks=[]; let size=0;
 while(true) {const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>max){await reader.cancel();fail(413,'檔案或資料超過上限');} chunks.push(value);}
 const out=new Uint8Array(size); let offset=0; for(const c of chunks){out.set(c,offset);offset+=c.length;} return out;
}
export async function settings(db) { return Object.fromEntries((await all(db,'SELECT * FROM settings')).map(r=>[r.key,JSON.parse(r.value)])); }
export function audit(db,actor,action,target,summary={}) {return stmt(db,'INSERT INTO audit_logs VALUES(?,?,?,?,?,?)',uid(),actor,action,target,JSON.stringify(summary),nowISO());}
export const modules = ['events','registrations','checkin','photos','notifications','export','feedback','admins'];
export function validateFields(fields) {
 if(!Array.isArray(fields)||fields.length<2||fields.length>50) fail(400,'欄位數量須為 2–50');
 const ids=new Set(); const types=['text','textarea','number','radio','checkboxes','select','date','checkbox'];
 for(const f of fields){
  if(!f || !/^[a-z][a-z0-9_]{0,49}$/.test(f.id)||ids.has(f.id)) fail(400,'欄位 ID 必須唯一，使用小寫英文與底線'); ids.add(f.id);
  if(!types.includes(f.type)||typeof f.required!=='boolean'||typeof f.enabled!=='boolean') fail(400,'欄位類型或設定錯誤');
  text(f.label,120); if(!f.label.trim()) fail(400,'欄位標題不可空白'); text(f.help||'',500); text(f.placeholder||'',200);
  if(['radio','checkboxes','select'].includes(f.type) && (!Array.isArray(f.options)||!f.options.length||f.options.length>50||new Set(f.options).size!==f.options.length||f.options.some(o=>typeof o!=='string'||!o.trim()||o.length>120))) fail(400,'選項不可空白或重複');
  if(f.maxLength!==undefined && (!Number.isInteger(f.maxLength)||f.maxLength<1||f.maxLength>4000)) fail(400,'文字長度上限須為 1–4000');
  for(const k of ['min','max']) if(f[k]!==undefined && (typeof f[k]!=='number'||!Number.isFinite(f[k]))) fail(400,'數字範圍錯誤');
  if(f.min!==undefined&&f.max!==undefined&&f.min>f.max) fail(400,'數字範圍錯誤');
 }
 for(const id of ['name','email']) {const f=fields.find(f=>f.id===id); if(!f||f.type!=='text'||id==='email'&&!f.required||!f.enabled) fail(400,'姓名與 Email 必須保留為啟用文字欄位，Email 必填');}
 const count=fields.find(f=>f.id==='participant_count'); if(count&&(!count.enabled||!count.required||count.type!=='number'||count.min!==1||!Number.isInteger(count.max)||count.max<1||count.max>100000)) fail(400,'參加人數須保留為必填數字，最少 1 位，上限可設定至 100000');
 return fields;
}
export function validateAnswers(fields,raw) {
 if(!raw||Array.isArray(raw)||typeof raw!=='object') fail(400,'答案格式錯誤'); const answers={}; const errors={};
 for(const f of fields.filter(f=>f.enabled)) {
  let v=raw[f.id]; const empty=v===undefined||v===null||v===''||Array.isArray(v)&&!v.length||f.type==='checkbox'&&v!==true;
  if(empty){if(f.required) errors[f.id]=`${f.label}為必填`; else answers[f.id]=f.type==='checkbox'?false:f.type==='checkboxes'?[]:'';continue;}
  if(['text','textarea','date','select','radio'].includes(f.type)) {
   if(typeof v!=='string'||v.trim().length>(f.maxLength||4000)) errors[f.id]='文字格式或長度錯誤'; else {v=v.trim();if(!v&&f.required) errors[f.id]='請填寫此欄位';}
   if(['select','radio'].includes(f.type)&&!f.options.includes(v)) errors[f.id]='請選擇有效選項';
   if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)) errors[f.id]='日期格式錯誤';
  } else if(f.type==='number') {if(typeof v!=='number'||!Number.isFinite(v)||f.min!==undefined&&v<f.min||f.max!==undefined&&v>f.max) errors[f.id]='數字不在有效範圍';}
  else if(f.type==='checkboxes'){if(!Array.isArray(v)||new Set(v).size!==v.length||v.some(o=>!f.options.includes(o))) errors[f.id]='請選擇有效選項';}
  else if(f.type==='checkbox' && typeof v!=='boolean') errors[f.id]='勾選格式錯誤';
  answers[f.id]=v;
 }
 if(!emailValid(answers.email)) errors.email='請填寫有效 Email';
 if(Object.keys(errors).length) fail(400,'請檢查報名欄位',errors);
 answers.email=normalizeEmail(answers.email); return answers;
}
export function csvCell(v) {let s=typeof v==='object'?JSON.stringify(v):String(v??'');if(/^[\s]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export async function hash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function rateLimit(req,env,scope,limit=15) {
 const minute=Math.floor(Date.now()/60000); const ip=req.headers.get('cf-connecting-ip')||'local';
 const key=await hash(`${env.RATE_SALT||'local'}:${scope}:${ip}:${minute}`);
 const r=await stmt(env.DB,'INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',key,new Date(Date.now()+120000).toISOString()).first();
 if(r.count>limit) fail(429,'操作太頻繁，請稍後再試');
}
export function assertOrigin(req) {if(['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.get('origin')!==new URL(req.url).origin) fail(403,'來源驗證失敗');}
