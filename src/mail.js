import {emailLayout} from './email-layout.js';
import {googleCalendarURL,icsURL} from './calendar.js';
import {feedbackKinds,feedbackPayload,feedbackJobEligible} from './feedback-core.js';
import {all,one,stmt,run,uid,nowISO,settings,fail,emailValid,escapeHTML,dateLabel,statusLabel,readLimited} from './lib.js';
const variables=['name','event_name','date','location','code','status','notes','contact','seats'];
export function validateTemplate(subject,body) {
 if(typeof subject!=='string'||!subject.trim()||subject.length>200||/[\r\n]/.test(subject)||typeof body!=='string'||!body.trim()||body.length>10000)fail(400,'通知主旨或內容格式錯誤');
 const keys=[...(subject+' '+body).matchAll(/{{\s*([^}]+)\s*}}/g)].map(m=>m[1].trim());if(keys.some(k=>!variables.includes(k)))fail(400,'通知包含不支援的變數');
}
export function renderTemplate(template,data,options={}){
 const interpolate=s=>s.replace(/{{\s*(\w+)\s*}}/g,(_,key)=>String(data[key]??''));
 const subject=interpolate(template.subject).replace(/[\r\n]/g,' ');const text=interpolate(template.body);
 return {subject,text,html:emailLayout({subject,text,data,kind:template.kind,...options})};
}
export async function payloadFor(db,job,env,options={}) {
 if(feedbackKinds.includes(job.kind))return feedbackPayload(db,job,env,options);
 const row=await one(db,`SELECT r.*,s.starts_at,s.ends_at,s.location,s.fee,s.event_id,s.status session_status,e.title,e.notes,e.contact,e.status event_status FROM registrations r JOIN event_sessions s ON s.id=r.session_id JOIN events e ON e.id=s.event_id WHERE r.id=?`,job.registration_id);
 if(!row) return null;
 const tpl=await one(db,'SELECT * FROM email_templates WHERE kind=? ORDER BY version DESC LIMIT 1',job.kind);if(!tpl)throw Error('template_missing');
 const cc=String(env.MAIL_CC||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(cc.some(address=>!emailValid(address)))throw Error('invalid_mail_cc');
 return {from:env.MAIL_FROM,to:[row.email],...(cc.length?{cc}:{}),...(env.MAIL_REPLY_TO?{reply_to:env.MAIL_REPLY_TO}:{}),...renderTemplate(tpl,{name:row.name||'參加者',event_name:row.title,date:dateLabel(row.starts_at),location:row.location,code:row.code,status:statusLabel(row.status),notes:row.notes,contact:row.contact,seats:row.seats,calendar:calendarFor(env,row,job.kind)},{replyTo:env.MAIL_REPLY_TO,siteUrl:mailSiteURL(env)})};
}
// Absolute links need SITE_URL; without it the mail simply has no calendar links or site button.
function mailSiteURL(env){const u=String(env.SITE_URL||'').replace(/\/$/,'');return /^https?:\/\/[^/]+$/.test(u)?u:'';}
function calendarFor(env,row,kind){const base=mailSiteURL(env);if(!base||!['receipt','confirmation','reminder','reschedule'].includes(kind))return null;const s={title:row.title,starts_at:row.starts_at,ends_at:row.ends_at,location:row.location,fee:row.fee};return {ics:icsURL(base,row.session_id),google:googleCalendarURL(s,base)};
}
export async function jobEligible(db,job,now) {
 // Organizer-entered registrations may have no email; their jobs are skipped instead of failing at the provider.
 if(job.registration_id){const r=await one(db,'SELECT email FROM registrations WHERE id=?',job.registration_id);if(r&&!emailValid(r.email))return false;}
 if(feedbackKinds.includes(job.kind))return feedbackJobEligible(db,job,now);
 if(!job.registration_id)return job.kind==='test';
 const r=await one(db,`SELECT r.status,s.starts_at,s.status session_status,e.status event_status FROM registrations r JOIN event_sessions s ON s.id=r.session_id JOIN events e ON e.id=s.event_id WHERE r.id=?`,job.registration_id);
 if(!r)return false;
 if(job.kind==='cancellation')return r.session_status==='cancelled'||r.event_status==='cancelled';
 if(r.status==='cancelled'||r.session_status!=='published'||r.event_status!=='published')return false;
 if(job.kind==='confirmation'||job.kind==='reminder')return r.status==='confirmed'&&(job.kind!=='reminder'||r.starts_at>now);
 return true;
}
export async function processJobs(env,clock=new Date(),fetcher=fetch) {
 const now=clock.toISOString();
 await run(env.DB,'DELETE FROM rate_limits WHERE expires_at<?',now);
 await run(env.DB,"DELETE FROM webhook_events WHERE created_at<?",new Date(clock.getTime()-30*86400000).toISOString());
 if(env.MAIL_MODE==='disabled'||!env.MAIL_MODE)return {processed:0,disabled:true};
 if(env.MAIL_MODE==='mock'&&env.APP_ENV!=='development')return {processed:0,disabled:true};
 if(env.MAIL_MODE==='resend'&&(!env.RESEND_API_KEY||!env.MAIL_FROM))return {processed:0,unconfigured:true};
 if(env.MAIL_MODE==='resend'&&env.APP_ENV==='production'&&!env.RATE_SALT)return {processed:0,unconfigured:true};
 const jobs=await all(env.DB,"SELECT * FROM email_jobs WHERE (status='pending' AND due_at<=?) OR (status='processing' AND lease_until<=?) ORDER BY due_at LIMIT 30",now,now);
 let processed=0;
 for(const job of jobs) {
  const token=uid(),lease=new Date(clock.getTime()+120000).toISOString();
  const claim=await run(env.DB,`UPDATE email_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=? AND ((status='pending' AND due_at<=?) OR (status='processing' AND lease_until<=?))`,token,lease,now,now,job.id,now,now);
  if(!claim.meta.changes)continue;
  const finish=async(status,error=null,providerId=null,due=now)=>env.DB.batch([
   stmt(env.DB,'UPDATE email_jobs SET status=?,last_error=?,provider_id=COALESCE(?,provider_id),due_at=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND status=\'processing\'',status,error,providerId,due,now,job.id,token),
   stmt(env.DB,'INSERT INTO email_logs SELECT ?,id,?,?,? FROM email_jobs WHERE id=? AND lease_token=?',uid(),status,error,now,job.id,token)
  ]);
  if(!await jobEligible(env.DB,job,now)){await finish('cancelled');continue;}
  if(job.first_attempt_at && clock.getTime()-Date.parse(job.first_attempt_at)>=23*3600000){await finish('unknown','retry_window_expired_verify_provider');continue;}
  try {
   let payload=job.payload_json?JSON.parse(job.payload_json):await payloadFor(env.DB,job,env);if(!payload){await finish('cancelled');continue;}
   // Feedback payloads hold a personal link token, so they are rendered per attempt and never stored.
   if(!job.payload_json&&!feedbackKinds.includes(job.kind)){await run(env.DB,'UPDATE email_jobs SET payload_json=? WHERE id=? AND lease_token=? AND status=\'processing\'',JSON.stringify(payload),job.id,token);}
   if(env.APP_ENV!=='production'){
    const allowed=String(env.TEST_RECIPIENTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(env.MAIL_MODE!=='mock'&&![...payload.to,...(payload.cc||[]),...(payload.bcc||[])].every(s=>allowed.includes(s.toLowerCase()))){await finish('failed','test_recipient_not_allowed');continue;}
   }
   if(env.MAIL_MODE==='mock'){await finish('accepted',null,'mock-'+job.id);processed++;continue;}
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
   let response;try{response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':job.unique_key},body:JSON.stringify(payload),signal:controller.signal});}finally{clearTimeout(timeout);}
   if(!response.ok){
    const transient=response.status===429||response.status>=500;
    if(transient)throw Error('provider_temporary_'+response.status);
    await finish('failed','provider_rejected_'+response.status);continue;
   }
   const result=await response.json();if(!result.id)throw Error('provider_result_unknown');
   await finish('accepted',null,result.id);processed++;
  }catch{
   const attempts=job.attempts+1;const due=new Date(clock.getTime()+Math.min(6*3600000,60000*2**attempts)).toISOString();
   await finish(attempts>=6?'unknown':'pending',attempts>=6?'retry_limit_verify_provider':'temporary_failure',null,due);
  }
 }
 return {processed};
}
function bytes64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export async function verifyWebhook(raw,headers,secret,clock=Date.now()) {
 if(!secret)fail(503,'Webhook 尚未設定');
 const id=headers.get('svix-id'),timestamp=headers.get('svix-timestamp'),signatures=headers.get('svix-signature');
 if(!id||id.length>200||!timestamp||!signatures||!/^\d+$/.test(timestamp)||Math.abs(clock/1000-Number(timestamp))>300)fail(401,'Webhook 驗證失敗');
 try {
  const key=await crypto.subtle.importKey('raw',bytes64(secret.replace(/^whsec_/,'')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signed=new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
  for(const part of signatures.split(' ')){const [version,sig]=part.split(',');if(version==='v1'&&sig&&await crypto.subtle.verify('HMAC',key,bytes64(sig),signed))return id;}
 }catch{}
 fail(401,'Webhook 驗證失敗');
}
export async function webhook(req,env) {
 const raw=new TextDecoder().decode(await readLimited(req,65536));const id=await verifyWebhook(raw,req.headers,env.RESEND_WEBHOOK_SECRET);
 let b;try{b=JSON.parse(raw);}catch{fail(400,'Webhook JSON 錯誤');}
 const status={'email.delivered':'delivered','email.bounced':'bounced','email.failed':'failed'}[b.type];
 const now=nowISO();const provider=b.data?.email_id;
 const statements=[stmt(env.DB,'INSERT OR IGNORE INTO webhook_events VALUES(?,?)',id,now)];
 if(status&&typeof provider==='string'){
  // The changes() guard makes duplicate webhook IDs inert; bounce/failure is terminal.
  statements.push(stmt(env.DB,`UPDATE email_jobs SET status=?,updated_at=? WHERE provider_id=? AND changes()=1 AND status IN('accepted','processing','unknown','delivered') AND (status<>'delivered' OR ? IN('bounced','failed'))`,status,now,provider,status));
  statements.push(stmt(env.DB,`INSERT INTO email_logs SELECT ?,id,?,NULL,? FROM email_jobs WHERE provider_id=? AND changes()>0`,uid(),status,now,provider));
 }
 await env.DB.batch(statements);return {ok:true};
}
