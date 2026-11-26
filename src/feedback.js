import {fail,uid,nowISO,stmt,one,all,audit,text,emailValid,normalizeEmail,rateLimit,dateLabel} from './lib.js';
import {processJobs} from './mail.js';
import {questions,ratingKeys,ratingLabels,validateFeedback,tokenPattern,tokenHash,tokenSecret,inviteToken,randomToken,randomNonce,siteURL,feedbackURL,feedbackMessage,exclusionReason,recipientModes,feedbackStats,feedbackCSV,formatAverage,difficultyLabel,attendLabel} from './feedback-core.js';

const uuid=/^[a-f0-9-]{36}$/i,day=86400000,inviteDays=30,testDays=7;
const later=(now,days)=>new Date(Date.parse(now)+days*day).toISOString();
const lastJob=`LEFT JOIN email_jobs j ON j.id=(SELECT id FROM email_jobs WHERE registration_id=r.id AND kind IN('feedback_invite','feedback_reminder') ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
const sessionLabel=r=>r.starts_at?`${dateLabel(r.starts_at)} · ${r.location}`:'—';
const person=r=>({registration_id:r.registration_id,code:r.code,name:r.name,email:r.email,status:r.status,session:sessionLabel(r),checked_in:!!r.checked_in_at});

async function formRow(db,id){const f=await one(db,'SELECT f.*,e.title event_title,e.status event_status FROM feedback_forms f JOIN events e ON e.id=f.event_id WHERE f.id=?',id);if(!f)fail(404,'找不到回饋表');return f;}
async function course(db,eventId){
 const sessions=await all(db,'SELECT id,starts_at,ends_at,location,status FROM event_sessions WHERE event_id=? ORDER BY starts_at',eventId);
 const counts=await one(db,"SELECT COUNT(*) total,COALESCE(SUM(r.status IN('pending','confirmed')),0) valid,COALESCE(SUM(r.status='cancelled'),0) cancelled,COALESCE(SUM(r.status='waitlisted'),0) waitlisted,COALESCE(SUM(c.registration_id IS NOT NULL),0) attended FROM registrations r JOIN event_sessions s ON s.id=r.session_id LEFT JOIN checkins c ON c.registration_id=r.id WHERE s.event_id=?",eventId);
 return {sessions,counts};
}
// Every registration of the event with its invitation and latest feedback mail attempt.
const candidates=(db,form)=>all(db,`SELECT r.id registration_id,r.code,r.name,r.email,r.normalized_email,r.status,r.session_id,s.starts_at,s.location,c.checked_in_at,i.id invitation_id,i.sent_at,i.used_at,i.expires_at,j.id last_job_id,j.status last_status,j.attempts,j.last_error FROM registrations r JOIN event_sessions s ON s.id=r.session_id LEFT JOIN checkins c ON c.registration_id=r.id LEFT JOIN feedback_invitations i ON i.registration_id=r.id AND i.form_id=? ${lastJob} WHERE s.event_id=? ORDER BY s.starts_at,r.created_at,r.id`,form.id,form.event_id);
async function recipientList(db,form,mode){
 if(!recipientModes[mode])fail(400,'請選擇收件對象');
 const included=[],excluded=[];
 for(const r of await candidates(db,form)){const reason=exclusionReason(r,mode);if(reason)excluded.push({...r,reason});else included.push(r);}
 const byEmail=new Map();for(const r of included)byEmail.set(r.normalized_email,(byEmail.get(r.normalized_email)||0)+1);
 return {included,excluded,duplicates:[...byEmail].filter(([,n])=>n>1).map(([email,count])=>({email,count}))};
}
const retryable=r=>r.invitation_id&&!r.sent_at&&!r.used_at&&['failed','bounced'].includes(r.last_status)&&['pending','confirmed'].includes(r.status)&&emailValid(r.normalized_email);
function previewMessage(env,form,kind,session,test=false){
 const site=String(env.SITE_URL||'').replace(/\/$/,'');
 return feedbackMessage(kind,{event_name:form.event_title,event_date:session?dateLabel(session.starts_at):'（依收件者報名場次）',event_location:session?.location||'（依收件者報名場次）',feedback_url:feedbackURL(site,form.slug,'（每位收件者的專屬連結）')},{replyTo:env.MAIL_REPLY_TO,test});
}
const confirmInput=b=>{if(b.confirm!==true)fail(400,'請再次確認寄送內容');if(typeof b.operation_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.operation_id))fail(400,'操作識別格式錯誤');b.operation_id=b.operation_id.toLowerCase();};

async function enqueue(req,env,admin,form,mode,b,now){
 const db=env.DB;if(form.status!=='published')fail(409,'表單開放填寫後才能正式寄送');confirmInput(b);
 const kind=mode==='reminder'?'feedback_reminder':'feedback_invite';
 // Same confirmation clicked twice: return the first result instead of a "list changed" error.
 // D1 limits LIKE pattern length, so match the operation id suffix exactly.
 const repeated=await one(db,"SELECT COUNT(*) n FROM email_jobs WHERE kind=? AND substr(unique_key,-36)=?",kind,b.operation_id.toLowerCase());
 if(repeated.n)return {queued:repeated.n,repeated:true};
 const secret=tokenSecret(env);siteURL(env);
 const {included}=await recipientList(db,form,mode);
 if(!included.length)fail(409,'目前沒有符合條件的收件者');
 if(b.expected_count!==included.length)fail(409,'收件名單已變更，請重新預覽後再寄送',{reload:true});
 const invites=[],jobs=[],expires=later(now,inviteDays);
 for(const r of included){
  if(r.invitation_id)invites.push(stmt(db,'UPDATE feedback_invitations SET expires_at=MAX(expires_at,?),updated_at=? WHERE id=? AND used_at IS NULL',expires,now,r.invitation_id));
  else{const id=uid(),token_nonce=randomNonce();invites.push(stmt(db,'INSERT OR IGNORE INTO feedback_invitations(id,form_id,registration_id,token_nonce,token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,form.id,r.registration_id,token_nonce,await tokenHash(await inviteToken(secret,{id,token_nonce})),expires,now,now));}
  // 0034 feedback_job_guard silently skips a job when one is still queued or the invitation is no longer eligible.
  jobs.push(stmt(db,'INSERT OR IGNORE INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',uid(),r.registration_id,r.session_id,kind,`${kind}:${r.registration_id}:${b.operation_id}`,now,now,now));
 }
 const out=await db.batch([...invites,...jobs,audit(db,admin.email,mode==='reminder'?'feedback.remind':'feedback.send',form.id,{mode,count:included.length,operation:b.operation_id})]);
 const queued=out.slice(invites.length,invites.length+jobs.length).reduce((n,r)=>n+(r.meta?.changes||0),0);
 const result=await processJobs(env);return {queued,processed:result.processed||0};
}
async function retry(env,admin,form,b,now){
 const db=env.DB;if(form.status!=='published')fail(409,'表單開放填寫後才能重試寄送');confirmInput(b);
 const rows=(await candidates(db,form)).filter(retryable);if(!rows.length)fail(409,'沒有可重試的失敗寄送');
 const jobs=rows.map(r=>stmt(db,'INSERT OR IGNORE INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',uid(),r.registration_id,r.session_id,'feedback_invite','feedback_retry:'+r.last_job_id,now,now,now));
 const out=await db.batch([...jobs,audit(db,admin.email,'feedback.retry',form.id,{count:rows.length,operation:b.operation_id})]);
 const result=await processJobs(env);return {queued:out.slice(0,jobs.length).reduce((n,r)=>n+(r.meta?.changes||0),0),processed:result.processed||0};
}
async function testMail(env,admin,form,b,now){
 const db=env.DB,to=normalizeEmail(b.email);if(!emailValid(to))fail(400,'請填寫有效的測試收件 Email');
 const kind=b.kind==='reminder'?'reminder':'invite',site=siteURL(env),token=randomToken(),jid=uid();
 const session=(await course(db,form.event_id)).sessions.find(s=>s.status!=='cancelled');
 const msg=feedbackMessage(kind,{event_name:form.event_title,event_date:session?dateLabel(session.starts_at):'（尚未設定場次）',event_location:session?.location||'（尚未設定）',feedback_url:feedbackURL(site,form.slug,token)},{replyTo:env.MAIL_REPLY_TO,test:true});
 // Test links point at feedback_test_tokens (preview only): no invitation, no response, no statistics.
 await db.batch([
  stmt(db,'INSERT INTO feedback_test_tokens(id,form_id,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)',uid(),form.id,await tokenHash(token),later(now,testDays),admin.email,now),
  stmt(db,'INSERT INTO email_jobs(id,kind,unique_key,due_at,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',jid,'feedback_test','feedback_test:'+jid,now,JSON.stringify({from:env.MAIL_FROM||'mock@digital-neighbors.test',to:[to],...(env.MAIL_REPLY_TO?{reply_to:env.MAIL_REPLY_TO}:{}),...msg}),now,now),
  audit(db,admin.email,'feedback.test',form.id,{kind})
 ]);
 await processJobs(env);const job=await one(db,'SELECT status,last_error FROM email_jobs WHERE id=?',jid);return {id:jid,status:job.status,error:job.last_error};
}

async function list(db){
 const forms=await all(db,`SELECT f.id,f.event_id,f.title,f.status,f.created_at,e.title event_title,(SELECT MIN(starts_at) FROM event_sessions WHERE event_id=f.event_id AND status<>'cancelled') starts_at,(SELECT COUNT(*) FROM feedback_invitations WHERE form_id=f.id AND sent_at IS NOT NULL) sent,(SELECT COUNT(*) FROM feedback_responses WHERE form_id=f.id) responses,(SELECT AVG(overall_rating) FROM feedback_responses WHERE form_id=f.id) overall FROM feedback_forms f JOIN events e ON e.id=f.event_id ORDER BY starts_at DESC,f.created_at DESC`);
 for(const f of forms)f.overall_display=formatAverage(f.overall);
 const events=await all(db,"SELECT e.id,e.title,e.status,(SELECT MIN(starts_at) FROM event_sessions WHERE event_id=e.id AND status<>'cancelled') starts_at,EXISTS(SELECT 1 FROM feedback_forms WHERE event_id=e.id) has_form FROM events e WHERE e.status<>'cancelled' ORDER BY starts_at DESC,e.created_at DESC");
 return {forms,events,questions};
}
async function create(db,admin,b,now){
 const e=await one(db,'SELECT id,title,status FROM events WHERE id=?',String(b.event_id||''));if(!e)fail(404,'找不到活動');if(e.status==='cancelled')fail(409,'已取消的活動不可建立回饋表');
 if(await one(db,'SELECT id FROM feedback_forms WHERE event_id=?',e.id))fail(409,'此活動已建立回饋表，每個活動僅能建立一份');
 const id=uid(),slug='c-'+uid().replaceAll('-','').slice(0,12),title=`${e.title}｜課程回饋`.slice(0,200);
 await db.batch([stmt(db,'INSERT INTO feedback_forms(id,event_id,slug,title,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,e.id,slug,title,'感謝您參加本次課程！填寫約需 1～2 分鐘，您的意見將協助我們規劃更好的課程。','draft',now,now),audit(db,admin.email,'feedback.create',id,{event:e.id})]);
 return {id};
}
async function results(db,form){
 const {counts}=await course(db,form.event_id);
 const invitations=await all(db,`SELECT i.sent_at,i.used_at,j.status last_status FROM feedback_invitations i JOIN registrations r ON r.id=i.registration_id ${lastJob} WHERE i.form_id=?`,form.id);
 const responses=await all(db,'SELECT * FROM feedback_responses WHERE form_id=? ORDER BY submitted_at DESC',form.id);
 return {...feedbackStats({registrations:counts.valid,attended:counts.attended,invitations,responses}),comments:responses.filter(r=>r.comment).map(r=>({id:r.id,comment:r.comment,submitted_at:r.submitted_at}))};
}

export async function feedbackAdmin(req,env,admin,url,parts,b,need){
 need('feedback');const db=env.DB,method=req.method,[,id,action,sub]=parts,now=nowISO();
 if(parts.length>4||(sub&&action!=='email'))fail(404,'找不到 API');
 if(!id){if(method==='GET')return list(db);if(method==='POST')return create(db,admin,b,now);fail(405,'不支援此方法');}
 const form=await formRow(db,id);
 if(!action){
  if(method==='GET'){const c=await course(db,form.event_id);return {form,course:{event_id:form.event_id,title:form.event_title,...c},questions,rating_labels:ratingLabels,modes:recipientModes,site_ready:!!env.SITE_URL};}
  if(method!=='PATCH')fail(405,'不支援此方法');
  const title=text(b.title??form.title,200),description=text(b.description??form.description,2000);if(!title)fail(400,'請填寫回饋表標題');
  await db.batch([stmt(db,'UPDATE feedback_forms SET title=?,description=?,updated_at=? WHERE id=?',title,description,now,id),audit(db,admin.email,'feedback.update',id)]);return {ok:true};
 }
 if(method==='POST'&&['publish','close'].includes(action)){
  const to=action==='publish'?'published':'closed';
  if(action==='publish'&&!['draft','closed'].includes(form.status))fail(409,'表單已在收集中');
  if(action==='publish'&&form.event_status==='cancelled')fail(409,'活動已取消，不可開放填寫');
  if(action==='close'&&form.status!=='published')fail(409,'只有收集中的表單可以關閉');
  const r=await stmt(db,"UPDATE feedback_forms SET status=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END,closed_at=CASE WHEN ?='closed' THEN ? ELSE NULL END,updated_at=? WHERE id=? AND status=?",to,to,now,to,now,now,id,form.status).run();
  if(!r.meta.changes)fail(409,'表單狀態已變更，請重新整理');
  await audit(db,admin.email,'feedback.'+(action==='close'?'close':form.status==='closed'?'reopen':'publish'),id).run();return {ok:true,status:to};
 }
 if(method==='POST'&&action==='preview'){
  const token=randomToken();await db.batch([stmt(db,'INSERT INTO feedback_test_tokens(id,form_id,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)',uid(),id,await tokenHash(token),later(now,1),admin.email,now)]);
  return {url:feedbackURL('',form.slug,token)};
 }
 if(method==='GET'&&action==='results')return results(db,form);
 if(method==='GET'&&action==='responses')return (await all(db,'SELECT * FROM feedback_responses WHERE form_id=? ORDER BY submitted_at DESC',id)).map(r=>({...r,difficulty_label:difficultyLabel(r.difficulty),attend_again_label:attendLabel(r.attend_again)}));
 if(method==='GET'&&action==='invitations')return (await all(db,`SELECT i.id invitation_id,i.sent_at,i.used_at,i.expires_at,r.id registration_id,r.code,r.name,r.email,r.status,s.starts_at,s.location,c.checked_in_at,j.status last_status,j.kind last_kind,j.attempts,j.last_error,j.updated_at last_updated FROM feedback_invitations i JOIN registrations r ON r.id=i.registration_id JOIN event_sessions s ON s.id=r.session_id LEFT JOIN checkins c ON c.registration_id=r.id ${lastJob} WHERE i.form_id=? ORDER BY s.starts_at,r.created_at`,id)).map(r=>({...person(r),invitation_id:r.invitation_id,sent_at:r.sent_at,completed:!!r.used_at,expired:!r.used_at&&r.expires_at<=now,expires_at:r.expires_at,last_status:r.last_status,last_kind:r.last_kind,attempts:r.attempts,last_error:r.last_error,last_updated:r.last_updated}));
 if(method==='GET'&&action==='export'){
  need('export');const responses=await all(db,'SELECT * FROM feedback_responses WHERE form_id=? ORDER BY submitted_at',id);
  await audit(db,admin.email,'feedback.export',id,{count:responses.length}).run();
  return new Response(feedbackCSV({id:form.event_id,title:form.event_title},responses),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="course-feedback.csv"'}});
 }
 if(method==='POST'&&action==='email'){
  await rateLimit(req,env,'feedback-mail',15);
  if(sub==='preview'){
   const mode=b.mode||'registered',{included,excluded,duplicates}=await recipientList(db,form,mode),summary={};
   for(const r of excluded)summary[r.reason]=(summary[r.reason]||0)+1;
   const {sessions}=await course(db,form.event_id),live=sessions.filter(s=>s.status!=='cancelled');
   return {mode,mode_label:recipientModes[mode],form_status:form.status,can_send:form.status==='published'&&included.length>0,count:included.length,recipients:included.map(person),excluded:excluded.map(r=>({...person(r),reason:r.reason})),excluded_summary:Object.entries(summary).map(([reason,count])=>({reason,count})),duplicates,retryable:(await candidates(db,form)).filter(retryable).map(person),message:previewMessage(env,form,mode==='reminder'?'reminder':'invite',live.length===1?live[0]:null)};
  }
  if(sub==='test')return testMail(env,admin,form,b,now);
  if(sub==='send'){if(!['registered','attended'].includes(b.mode))fail(400,'請選擇收件對象');return enqueue(req,env,admin,form,b.mode,b,now);}
  if(sub==='remind')return enqueue(req,env,admin,form,'reminder',b,now);
  if(sub==='retry')return retry(env,admin,form,b,now);
 }
 fail(404,'找不到 API');
}

// Resident side: the token arrives in the X-Feedback-Token header so it never appears in API URLs or logs.
const stateMessage={used:'您已完成本次課程回饋，感謝您的參與。',expired:'此填寫連結已過期，如需協助請聯絡主辦單位。',not_open:'本課程回饋尚未開放填寫，請稍後再試。',closed:'本課程回饋已停止收集，感謝您的關心。'};
const thanks='感謝您的寶貴意見，期待未來與您再次一起學習。';
const stateOf=(row,now)=>row.used_at?'used':row.expires_at<=now?'expired':row.preview?'open':row.status==='draft'?'not_open':row.status==='closed'?'closed':'open';
async function resolve(db,slug,token){
 if(typeof slug!=='string'||!/^[a-z0-9-]{3,64}$/.test(slug)||!tokenPattern.test(token))fail(401,'請使用 Email 中的專屬填寫連結開啟');
 const h=await tokenHash(token);
 let row=await one(db,`SELECT i.id invitation_id,i.expires_at,i.used_at,i.submission_id,f.id form_id,f.slug,f.title,f.description,f.status,e.title event_title,s.starts_at,s.location FROM feedback_invitations i JOIN feedback_forms f ON f.id=i.form_id JOIN registrations r ON r.id=i.registration_id JOIN event_sessions s ON s.id=r.session_id JOIN events e ON e.id=f.event_id WHERE i.token_hash=?`,h);
 if(!row){row=await one(db,`SELECT t.expires_at,f.id form_id,f.slug,f.title,f.description,f.status,e.title event_title,s.starts_at,s.location FROM feedback_test_tokens t JOIN feedback_forms f ON f.id=t.form_id JOIN events e ON e.id=f.event_id LEFT JOIN event_sessions s ON s.id=(SELECT id FROM event_sessions WHERE event_id=f.event_id AND status<>'cancelled' ORDER BY starts_at LIMIT 1) WHERE t.token_hash=?`,h);if(row)row.preview=true;}
 if(!row||row.slug!==slug)fail(404,'連結無效或已失效，請使用 Email 中的最新填寫連結');
 return {row,h};
}
export async function feedbackPublic(req,env,slug,action,b){
 const db=env.DB,submit=action==='submit',now=nowISO();
 await rateLimit(req,env,submit?'feedback-submit':'feedback',submit?10:30);
 const {row,h}=await resolve(db,slug,req.headers.get('x-feedback-token')||''),state=stateOf(row,now);
 if(!submit)return {state,message:state==='open'?null:stateMessage[state],preview:!!row.preview,form:{title:row.title,description:row.description},course:{title:row.event_title,date:row.starts_at?dateLabel(row.starts_at):'',location:row.location||''},questions,rating_labels:ratingLabels};
 if(typeof b.submission_id!=='string'||!uuid.test(b.submission_id))fail(400,'提交識別格式錯誤');
 if(row.preview){if(state!=='open')fail(410,stateMessage[state],{state});validateFeedback(b.answers);return {ok:true,preview:true,message:'測試預覽：答案格式正確，但不會儲存，也不計入統計。'};}
 if(row.used_at&&row.submission_id===b.submission_id)return {ok:true,message:thanks};
 if(state!=='open')fail(state==='expired'?410:409,stateMessage[state],{state});
 const a=validateFeedback(b.answers);
 // One transaction: mark the invitation used only if still unused/open, and insert the response only when that update won.
 let out;try{out=await db.batch([
  stmt(db,"UPDATE feedback_invitations SET used_at=?,submission_id=?,updated_at=? WHERE id=? AND token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM feedback_forms f WHERE f.id=feedback_invitations.form_id AND f.status='published')",now,b.submission_id,now,row.invitation_id,h,now),
  stmt(db,'INSERT INTO feedback_responses(id,form_id,overall_rating,instructor_rating,content_rating,usefulness_rating,venue_rating,difficulty,attend_again,comment,submitted_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1',uid(),row.form_id,...ratingKeys.map(k=>a[k]),a.difficulty,a.attend_again,a.comment,now)
 ]);}catch(error){if(/feedback_form_closed|feedback_token_used/.test(String(error.message)))out=[{meta:{changes:0}},{meta:{changes:0}}];else throw error;}
 if(out[0].meta.changes===1&&out[1].meta.changes===1)return {ok:true,message:thanks};
 const after=await resolve(db,slug,req.headers.get('x-feedback-token')||'');
 if(after.row.used_at&&after.row.submission_id===b.submission_id)return {ok:true,message:thanks};
 const s=stateOf(after.row,nowISO());fail(s==='expired'?410:409,stateMessage[s]||'此表單目前無法提交，請重新整理',{state:s});
}
