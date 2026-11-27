import {signatureJSON} from './signature.js';
import {fail,uid,nowISO,stmt,one,all,run,settings,audit,text,iso,reminderAt,normalizeEmail,validateAnswers,validateFields,csvCell,modules,rateLimit,emailValid,dateLabel} from './lib.js';
import {authorize} from './auth.js';
import {uploadPhoto,thumbnail,updatePhoto,media} from './photos.js';
import {validateTemplate,renderTemplate,payloadFor,processJobs} from './mail.js';
import {feedbackAdmin} from './feedback.js';
import {feedbackKinds} from './feedback-core.js';
import {site} from './site.js';
import {turnstileSiteKey,verifyTurnstile} from './turnstile.js';
import {feeInput,seatLimitInput,quickEvent,duplicateEvent,setHidden,deleteEvent,restoreEvent,addRegistration,purgeRegistration,stats,statsCSV,uploadSiteImage,bannersAPI,publicBanners,aboutAPI,appearanceAPI} from './admin-tools.js';
const requiredRow=async(db,table,id)=>{const row=await one(db,`SELECT * FROM ${table} WHERE id=?`,id);if(!row)fail(404,'找不到資料');return row;};
const sessionQuery=`SELECT s.*,COALESCE(s.form_id,e.default_form_id) active_form_id,COALESCE((SELECT SUM(seats) FROM registrations r WHERE r.session_id=s.id AND r.status IN('pending','confirmed')),0) occupied,(SELECT COUNT(*) FROM registrations r WHERE r.session_id=s.id AND r.status='waitlisted') waitlisted FROM event_sessions s JOIN events e ON e.id=s.event_id`;
// Home page order: events with an upcoming (not yet ended, published) session first, soonest first; then past events, most recent first.
export function sortByDate(events,now=Date.now()){
 const key=e=>{const next=e.sessions.filter(s=>s.status==='published'&&Date.parse(s.ends_at)>=now).map(s=>Date.parse(s.starts_at));const last=e.sessions.map(s=>Date.parse(s.starts_at)).filter(Number.isFinite);return next.length?[0,Math.min(...next)]:[1,last.length?-Math.max(...last):Number.MAX_SAFE_INTEGER];};
 const keys=new Map(events.map(e=>[e,key(e)]));return events.sort((a,b)=>{const x=keys.get(a),y=keys.get(b);return x[0]-y[0]||x[1]-y[1];});
}
export async function publicData(env) {
 const cfg=await settings(env.DB);const events=await all(env.DB,"SELECT id,title,description,cover_photo_id,notes,contact FROM events WHERE status='published' AND hidden=0 AND deleted_at IS NULL ORDER BY created_at DESC");
 for(const e of events){
  e.sessions=await all(env.DB,sessionQuery+" WHERE s.event_id=? AND s.status IN('published','cancelled') ORDER BY starts_at",e.id);
  e.photos=await all(env.DB,"SELECT p.id,p.session_id,p.caption,p.width,p.height FROM event_photos p LEFT JOIN event_sessions s ON s.id=p.session_id WHERE p.event_id=? AND p.status='published' AND (p.session_id IS NULL OR s.status='published') ORDER BY p.sort_order,p.created_at",e.id);
  if(!e.photos.some(p=>p.id===e.cover_photo_id))e.cover_photo_id=null;
  for(const s of e.sessions){if(!e.photos.some(p=>p.id===s.cover_photo_id))s.cover_photo_id=null;delete s.form_id;}
 }
 sortByDate(events);
 return {brand:cfg.brand,english_brand:cfg.english_brand,events,banners:await publicBanners(env.DB),privacy:{version:cfg.privacy_version,summary:cfg.privacy_summary,body:cfg.privacy_body,statement:cfg.participation_statement}};
}
const participantRowLimit=100,ageGroups=['大','小'],genders=['男','女','其他'],identities=site.identities;
// Optional for older clients; when sent, one row per seat (capped) so the sign-in sheet matches the paper form.
export function participantsInput(value,seats){
 if(value===undefined||value===null)return null;
 if(!Array.isArray(value)||value.length!==Math.min(seats,participantRowLimit))fail(400,'參加者資料列數須與參加人數相同',{participants:'請依參加人數填寫每位參加者'});
 const rows=value.map((p,i)=>{
  if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'參加者資料格式錯誤');
  const name=typeof p.name==='string'?p.name.trim():'';if(name.length>50)fail(400,'每位姓名最多 50 字',{participants:`第 ${i+1} 位姓名最多 50 字`});
  if(i>0&&!name)fail(400,`請填寫第 ${i+1} 位參加者姓名`,{participants:`請填寫第 ${i+1} 位參加者姓名`});
  for(const [k,list] of [['age_group',ageGroups],['gender',genders],['identity',identities]])if(![undefined,null,'',...list].includes(p[k]))fail(400,'參加者選項錯誤');
  return {name,age_group:p.age_group||'',gender:p.gender||'',identity:p.identity||''};
 });
 return JSON.stringify(rows);
}
export async function publicForm(env,id) {
 const s=await one(env.DB,sessionQuery+" WHERE s.id=? AND s.status='published' AND e.status='published' AND e.hidden=0 AND e.deleted_at IS NULL",id);if(!s)fail(404,'找不到場次');
 const form=await requiredRow(env.DB,'form_versions',s.active_form_id);if(form.status!=='published')fail(404,'表單尚未發布');
 const cfg=await settings(env.DB);return {turnstile_site_key:turnstileSiteKey(env),session:s,form:{id:form.id,version:form.version,handwritten_name:true,participants:{max:participantRowLimit,age_groups:ageGroups,genders,identities},fields:JSON.parse(form.fields_json).map(f=>f.id==='name'?{...f,label:'請幫我填寫真實姓名',placeholder:'請填寫真實姓名'}:f.id==='participant_count'?{...f,max:Math.min(f.max??100000,s.max_seats_per_registration)}:f)},privacy:{version:cfg.privacy_version+':signin-fields-v1',summary:cfg.privacy_summary+' 您可手寫姓名，筆跡將用於報名核對及活動簽到表；每位參加者的姓名、大人／小孩、性別與身分用於製作活動簽到表。',body:cfg.privacy_body+'\n手寫姓名筆跡與報名資料一併保存，用於活動報名核對；實際到場後可帶入簽到表。亦可選擇鍵盤輸入姓名。\n每位參加者的姓名、大人／小孩、性別與身分（'+identities.join('、')+'）僅用於本場活動簽到表與名冊留存；性別、大人／小孩與身分可留空。',statement:cfg.participation_statement}};
}
export async function register(req,env,id,b) {
 await rateLimit(req,env,'registration',12);
 if(env.APP_ENV==='production'&&!env.RATE_SALT)fail(503,'報名服務尚未設定');
 const {session:s,form,privacy}=await publicForm(env,id);const cfg=await settings(env.DB);
 if(!cfg.operating_ready||!s.registration_open)fail(409,'此場次尚未開放報名');
 if(b.form_id!==form.id)fail(409,'報名表已更新，請重新載入；已填內容會保留',{reload:true});
 if(b.privacy_version!==privacy.version)fail(409,'個資說明已更新，請重新閱讀',{reload:true});
 if(b.privacy_consent!==true||b.participation_consent!==true)fail(400,'請勾選個資同意與參與聲明');
 if(typeof b.submission_id!=='string'||! /^[a-f0-9-]{36}$/i.test(b.submission_id))fail(400,'提交識別格式錯誤');
 const nameSignature=signatureJSON(b.name_signature);
 const answers=validateAnswers(nameSignature?form.fields.map(f=>f.id==='name'?{...f,required:false}:f):form.fields,b.answers);const email=normalizeEmail(answers.email);const seats=Number(answers.participant_count||1);
 if(!Number.isInteger(seats)||seats<1||seats>100000)fail(400,'參加人數須為 1–100000 位');
 if(seats>s.max_seats_per_registration)fail(400,`每筆報名最多 ${s.max_seats_per_registration} 位，人數較多請分開報名或洽主辦方`,{participant_count:`每筆最多 ${s.max_seats_per_registration} 位`});
 const participants=participantsInput(b.participants,seats);
 // A retried submission that already succeeded returns its result without a second (single-use) Turnstile token.
 const retried=await one(env.DB,"SELECT code,status,seats FROM registrations WHERE session_id=? AND submission_id=? AND status<>'cancelled'",id,b.submission_id);if(retried)return retried;
 await verifyTurnstile(req,env,b.turnstile_token);
 const existing=await one(env.DB,'SELECT * FROM registrations WHERE session_id=? AND normalized_email=?',id,email);
 if(existing && existing.status!=='cancelled') {
  if(existing.submission_id===b.submission_id)return {code:existing.code,status:existing.status,seats:existing.seats};
  fail(409,'此 Email 已報名此場次，請查看確認信或聯絡主辦方');
 }
 const now=nowISO(),rid=existing?.id||uid(),code=existing?.code||'DN-'+uid().slice(0,8).toUpperCase();
 const values=[answers.name||'',answers.email,email,form.id,JSON.stringify(answers),now,privacy.version,JSON.stringify(privacy),b.submission_id,seats,nameSignature,participants];
 if(existing){
  await stmt(env.DB,`UPDATE registrations SET name=?,email=?,normalized_email=?,form_id=?,answers_json=?,consent_at=?,consent_version=?,consent_json=?,submission_id=?,seats=?,name_signature_json=?,participants_json=?,generation=generation+1,status=CASE WHEN ?+(SELECT COALESCE(SUM(seats),0) FROM registrations WHERE session_id=? AND id<>? AND status IN('pending','confirmed'))<=(SELECT capacity FROM event_sessions WHERE id=?) THEN 'pending' ELSE 'waitlisted' END,created_at=?,updated_at=? WHERE id=? AND status='cancelled'`,...values,seats,id,rid,id,now,now,rid).run();
 } else {
  try {await stmt(env.DB,`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,answers_json,consent_at,consent_version,consent_json,submission_id,seats,name_signature_json,participants_json,status,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?+(SELECT COALESCE(SUM(seats),0) FROM registrations WHERE session_id=? AND status IN('pending','confirmed'))<=(SELECT capacity FROM event_sessions WHERE id=?) THEN 'pending' ELSE 'waitlisted' END,?,?`,rid,id,code,...values,seats,id,id,now,now).run();}
  catch(error){const duplicate=await one(env.DB,'SELECT code,status,seats,submission_id FROM registrations WHERE session_id=? AND normalized_email=?',id,email);if(duplicate?.submission_id===b.submission_id)return {code:duplicate.code,status:duplicate.status,seats:duplicate.seats};throw error;}
 }
 const saved=await one(env.DB,'SELECT code,status,seats FROM registrations WHERE id=?',rid);return saved;
}
function sessionInput(b,old={},event) {
 const s={...old,...b};s.starts_at=iso(s.starts_at);s.ends_at=iso(s.ends_at);if(s.ends_at<=s.starts_at)fail(400,'結束時間須晚於開始時間');
 if(s.timezone&&s.timezone!=='Asia/Taipei')fail(400,'第一期支援台灣時區');s.timezone='Asia/Taipei';s.location=text(s.location||'待定',300);Object.assign(s,feeInput(b,old));s.max_seats_per_registration=seatLimitInput(b.max_seats_per_registration,old.max_seats_per_registration);s.supplies=text(s.supplies||'',500);
 if(!Number.isInteger(s.capacity)||s.capacity<0||s.capacity>100000)fail(400,'名額須為有效非負整數');
 if(!['draft','published','cancelled'].includes(s.status||'draft'))fail(400,'場次狀態錯誤');s.status=s.status||'draft';
 s.registration_open=s.registration_open?1:0;s.reminder_enabled=s.reminder_enabled===undefined?1:s.reminder_enabled?1:0;
 s.opens_at=iso(s.opens_at,true);s.closes_at=iso(s.closes_at,true);if(s.opens_at&&s.closes_at&&s.opens_at>=s.closes_at)fail(400,'報名截止須晚於開放時間');
 s.reminder_time=s.reminder_time||'09:00';s.reminder_at=reminderAt(s.starts_at,s.reminder_time);
 if(s.registration_open&&(s.status!=='published'||s.capacity<1||s.location==='待定'||s.fee_type==='tbd'||!event.contact.trim()))fail(400,'開放報名前須確認場次發布、地點、名額、費用與主辦方聯絡方式');
 return s;
}
// Registration (not attendance) rows for the printable sheet: row 1 falls back to the contact's typed or handwritten name.
export function registrationSheetRows(r,fee){
 let people=[];try{people=JSON.parse(r.participants_json||'[]');}catch{}
 const count=Math.min(Math.max(r.seats||1,people.length,1),participantRowLimit);
 return Array.from({length:count},(_,i)=>{const p=people[i]||{},own=!!p.name;return {full_name:own?p.name:i===0?(r.name||''):'',signature_json:!own&&i===0?r.name_signature_json||null:null,age_group:p.age_group||'',gender:p.gender||'',identity:p.identity||'',fee_snapshot:fee};});
}
const checkinCode=/^DN-[0-9A-F]{8}$/;
async function checkinDetail(db,rid){
 const c=await one(db,'SELECT c.registration_id,c.checked_in_at,r.code,r.name,r.seats,r.status,r.name_signature_json,c.fee_snapshot FROM checkins c JOIN registrations r ON r.id=c.registration_id WHERE c.registration_id=?',rid);if(!c)fail(404,'尚未報到，請先選取報名資料');
 const attendees=(await all(db,'SELECT full_name FROM checkin_attendees WHERE registration_id=? ORDER BY position',rid)).map(a=>a.full_name);
 const people=await all(db,'SELECT a.full_name,d.signature_json,d.age_group,d.gender,d.identity,d.fee_status,d.fee_amount FROM checkin_attendees a LEFT JOIN checkin_attendee_details d ON d.registration_id=a.registration_id AND d.position=a.position WHERE a.registration_id=? ORDER BY a.position',rid);
 return {people,registration_id:c.registration_id,code:c.code,nickname:c.name,seats:c.seats,status:c.status,checked_in_at:c.checked_in_at,fee_snapshot:c.fee_snapshot,name_signature_json:c.name_signature_json,attendees};
}
function attendeeInput(b,max){
  if(!Array.isArray(b.names)||b.names.length<1||b.names.length>max)fail(400,`請填寫 1–${max} 位姓名`);
  const names=b.names.map(n=>typeof n==='string'?n.trim():'');if(names.some(n=>n.length>50))fail(400,'每位姓名最多 50 字');
  const people=b.people===undefined?names.map(()=>({})):b.people;
  if(!Array.isArray(people)||people.length!==names.length)fail(400,'簽到人數不符');
  const signatures=people.map(p=>{
   if(!p||typeof p!=='object')fail(400,'簽到資料格式錯誤');
   if(!['','大','小'].includes(p.age_group||'')||!['','男','女','其他'].includes(p.gender||'')||!['',...identities].includes(p.identity||''))fail(400,'簽到選項錯誤');
   if(p.fee_status!==undefined&&p.fee_status!==null&&!['','free','paid'].includes(p.fee_status))fail(400,'活動收費情形錯誤');
   if(p.fee_status==='paid'&&(!Number.isInteger(p.fee_amount)||p.fee_amount<0||p.fee_amount>1000000))fail(400,'繳費金額須為 0–1000000 元整數');
   if(p.signature===undefined||p.signature===null)return null;
   const a=p.signature;
   if(!Array.isArray(a)||!a.length||a.length>100||JSON.stringify(a).length>20000||a.some(line=>!Array.isArray(line)||line.length<1||line.length>1000||line.some(pt=>!Array.isArray(pt)||pt.length!==2||pt.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))))fail(400,'手寫簽名格式錯誤或筆畫過多');
   return JSON.stringify(a);
  });
  if(names.some((n,i)=>!n&&!signatures[i]))fail(400,'每位參加者請填寫或手寫姓名');
  return {names:names.map((n,i)=>n||'（手寫姓名）'),people,signatures};
}
function attendeeStatements(db,id,now,{names,people,signatures}){return names.flatMap((n,i)=>[
 stmt(db,'INSERT INTO checkin_attendees(registration_id,position,full_name,updated_at) VALUES(?,?,?,?)',id,i+1,n,now),
 stmt(db,'INSERT INTO checkin_attendee_details(registration_id,position,signature_json,age_group,gender,identity,fee_status,fee_amount) VALUES(?,?,?,?,?,?,?,?)',id,i+1,signatures[i],people[i].age_group||'',people[i].gender||'',people[i].identity||'',people[i].fee_status??null,people[i].fee_status==='paid'?people[i].fee_amount:null)
]);}

const onsiteFields=[{id:'name',type:'text',label:'請幫我填寫真實姓名',enabled:true,required:true,maxLength:50},{id:'email',type:'text',label:'電子郵件',enabled:true,required:true,maxLength:254},{id:'participant_count',type:'number',label:'參加人數',enabled:true,required:true,min:1,max:100}];
async function onsiteAPI(db,admin,url,method,b,now,need){
 need('checkin');need('registrations');
 const sid=method==='GET'?url.searchParams.get('session_id'):b.session_id;
 const s=await one(db,`SELECT s.*,e.title,e.status event_status,o.form_id onsite_form_id,COALESCE(o.enabled,0) onsite_open FROM event_sessions s JOIN events e ON e.id=s.event_id LEFT JOIN onsite_registration_forms o ON o.session_id=s.id WHERE s.id=?`,sid);
 if(!s)fail(404,'找不到場次');
 const cfg=await settings(db),onsiteNotice='現場填寫的姓名、手寫簽名、性別與身分用於本場活動簽到與名冊留存；電子郵件用於報名聯繫與通知。',privacy={version:cfg.privacy_version+':onsite-v1',summary:cfg.privacy_summary,body:cfg.privacy_body,statement:cfg.participation_statement,onsite_notice:onsiteNotice};
 if(method==='GET')return {session:s,form_id:s.onsite_form_id,privacy};
 if(method==='PATCH'){
  if(typeof b.enabled!=='boolean')fail(400,'請指定現場報名開放狀態');
  if(b.enabled&&(s.status!=='published'||s.event_status!=='published'||!cfg.operating_ready||s.location==='待定'||s.fee==='待定'||s.ends_at<=now))fail(409,'請先確認場次發布、時間、地點、費用與營運設定');
  const fid=s.onsite_form_id||uid();
  await db.batch([...(s.onsite_form_id?[]:[stmt(db,"INSERT INTO form_versions SELECT ?,?,COALESCE(MAX(version),0)+1,'published',?,? FROM form_versions WHERE event_id=?",fid,s.event_id,JSON.stringify(onsiteFields),now,s.event_id)]),stmt(db,'INSERT INTO onsite_registration_forms(session_id,form_id,enabled) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET enabled=excluded.enabled',sid,fid,b.enabled?1:0),audit(db,admin.email,'onsite.configure',sid,{enabled:b.enabled})]);return {ok:true};
 }
 if(method!=='POST')fail(405,'不支援此方法');
 if(typeof b.submission_id!=='string'||! /^[a-f0-9-]{36}$/i.test(b.submission_id))fail(400,'提交識別格式錯誤');
 const retry=await one(db,'SELECT id,session_id,registration_source FROM registrations WHERE submission_id=?',b.submission_id);
 if(retry){if(retry.session_id!==sid||retry.registration_source!=='onsite')fail(409,'提交識別已使用');return {...await checkinDetail(db,retry.id),status:'confirmed',registered:true};}
 if(!cfg.operating_ready||!s.onsite_open||s.status!=='published'||s.event_status!=='published'||s.ends_at<=now||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(s.starts_at))!==new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(now)))fail(409,'此場次目前未開放現場報名');
 if(b.form_id!==s.onsite_form_id||b.privacy_version!==privacy.version)fail(409,'表單或個資說明已更新，請重新閱讀並同意',{reload:true});
 if(b.privacy_consent!==true||b.participation_consent!==true)fail(400,'請勾選個資同意與參與聲明');
 const input=attendeeInput(b,100),email=normalizeEmail(b.email);
 if(!emailValid(email))fail(400,'請填寫有效的電子郵件');
 if(input.people.some(p=>!p.signature?.length))fail(400,'請完成每位到場者的手寫簽名');
 const existing=await one(db,'SELECT id FROM registrations WHERE session_id=? AND normalized_email=?',sid,email);
 if(existing)fail(409,'此 Email 已有報名紀錄，請由工作人員查找原報名，勿重複報名');
 const rid=uid(),code='DN-'+uid().slice(0,8).toUpperCase(),snapshot={...privacy,onsite_consent:true};
 try{await db.batch([
  stmt(db,`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,answers_json,consent_at,consent_version,consent_json,submission_id,seats,status,created_at,updated_at,registration_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',?,?,'onsite')`,rid,sid,code,input.names[0],email,email,s.onsite_form_id,JSON.stringify({name:input.names[0],email,participant_count:input.names.length}),now,privacy.version,JSON.stringify(snapshot),b.submission_id,input.names.length,now,now),
  stmt(db,'INSERT INTO checkins VALUES(?,?,?,?,?)',rid,sid,s.fee,now,admin.email),...attendeeStatements(db,rid,now,input),audit(db,admin.email,'onsite.register',rid,{session:sid,count:input.names.length})
 ]);}catch(error){const saved=await one(db,"SELECT id FROM registrations WHERE submission_id=? AND session_id=? AND registration_source='onsite'",b.submission_id,sid);if(saved)return {...await checkinDetail(db,saved.id),registered:true};throw error;}
 return {...await checkinDetail(db,rid),registered:true};
}
// Check-ins live outside registrations: attendance is not a registration status, and 0007 blocks registration updates once a session starts.
async function checkinAPI(db,admin,url,method,id,action,b,now,need){
 if(id==='onsite')return onsiteAPI(db,admin,url,method,b,now,need);
 if(id==='sheet'&&method==='GET'){
  need('export');const s=await one(db,'SELECT s.id,s.starts_at,s.ends_at,s.location,s.fee,e.id event_id,e.title FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE s.id=?',url.searchParams.get('session_id'));if(!s)fail(404,'找不到場次');
  const rows=await all(db,'SELECT a.full_name,d.signature_json,d.age_group,d.gender,d.identity,d.fee_status,d.fee_amount,c.fee_snapshot FROM checkin_attendees a LEFT JOIN checkin_attendee_details d ON d.registration_id=a.registration_id AND d.position=a.position JOIN checkins c ON c.registration_id=a.registration_id WHERE c.session_id=? ORDER BY c.checked_in_at,c.registration_id,a.position',s.id);
  await audit(db,admin.email,'checkin.sheet',s.id,{count:rows.length}).run();return {session:s,rows};
 }
 need('checkin');
 if(method==='POST'&&id==='search'){
  const sid=b.session_id,q=typeof b.query==='string'?b.query.trim():'';
  if(!sid||q.length<1)return [];
  if(q.length>254)fail(400,'搜尋文字過長');
  return all(db,"SELECT r.code,r.name,r.seats,r.status,c.checked_in_at FROM registrations r LEFT JOIN checkins c ON c.registration_id=r.id WHERE r.session_id=? AND r.status IN('pending','confirmed') AND (instr(r.name,?)>0 OR r.normalized_email=? OR r.code=?) ORDER BY r.created_at LIMIT 30",sid,q,normalizeEmail(q),q.toUpperCase());
 }
 if(method==='GET'&&id==='sessions')return all(db,"SELECT s.id,s.event_id,s.starts_at,s.ends_at,s.location,s.fee,s.status,e.title,COALESCE(o.enabled,0) onsite_open FROM event_sessions s JOIN events e ON e.id=s.event_id LEFT JOIN onsite_registration_forms o ON o.session_id=s.id WHERE s.status IN('published','cancelled') ORDER BY s.starts_at");
 if(method==='GET'&&!id){
  const sid=url.searchParams.get('session_id');if(!sid)fail(400,'請選擇場次');
  const expected=await one(db,"SELECT COUNT(*) registrations,COALESCE(SUM(seats),0) seats FROM registrations WHERE session_id=? AND status IN('pending','confirmed')",sid);
  const checkins=await all(db,'SELECT c.registration_id,c.checked_in_at,r.code,r.name,r.seats,(SELECT COUNT(*) FROM checkin_attendees a WHERE a.registration_id=c.registration_id) named FROM checkins c JOIN registrations r ON r.id=c.registration_id WHERE c.session_id=? ORDER BY c.checked_in_at DESC',sid);
  return {expected,checkins};
 }
 if(method==='POST'&&!id){
  const code=String(b.code??'').trim().toUpperCase();if(!checkinCode.test(code))fail(400,'報名編號格式不正確');
  const s=await one(db,'SELECT id,status,fee FROM event_sessions WHERE id=?',b.session_id);if(!s)fail(400,'請選擇場次');
  const r=await one(db,'SELECT r.id,r.session_id,r.status,s.starts_at,e.title FROM registrations r JOIN event_sessions s ON s.id=r.session_id JOIN events e ON e.id=s.event_id WHERE r.code=?',code);
  if(!r)fail(404,'找不到此報名編號');
  if(r.session_id!==s.id)fail(409,`此報名屬於其他場次：${r.title} · ${dateLabel(r.starts_at)}`);
  if(s.status==='cancelled')fail(409,'此場次已取消，無法報到');
  if(r.status==='waitlisted')fail(409,'此報名為候補，尚未取得名額，請洽工作人員');
  if(r.status==='cancelled')fail(409,'此報名已取消，無法報到');
  if(await one(db,'SELECT 1 FROM checkins WHERE registration_id=?',r.id))return {...await checkinDetail(db,r.id),already:true};
  try{await db.batch([stmt(db,'INSERT INTO checkins VALUES(?,?,?,?,?)',r.id,s.id,s.fee||'',now,admin.email),audit(db,admin.email,'registration.checkin',r.id,{session:s.id})]);}
  catch(error){if(!/UNIQUE constraint/.test(String(error.message)))throw error;return {...await checkinDetail(db,r.id),already:true};}
  return {...await checkinDetail(db,r.id),already:false};
 }
 if(method==='PUT'&&action==='attendees'){
  const c=await checkinDetail(db,id),max=Math.min(c.seats,100);
  const input=attendeeInput(b,max);
  await db.batch([stmt(db,'DELETE FROM checkin_attendees WHERE registration_id=?',id),...attendeeStatements(db,id,now,input),audit(db,admin.email,'checkin.attendees',id,{count:input.names.length})]);
  return checkinDetail(db,id);
 }
 if(method==='POST'&&action==='undo'){
  await checkinDetail(db,id);
  await db.batch([stmt(db,'DELETE FROM checkin_attendees WHERE registration_id=?',id),stmt(db,'DELETE FROM checkins WHERE registration_id=?',id),audit(db,admin.email,'checkin.undo',id)]);return {ok:true};
 }
 fail(404,'找不到 API');
}
export async function adminAPI(req,env,admin,url,parts,b) {
 const db=env.DB,cfg=await settings(db),method=req.method,resource=parts[0],id=parts[1],action=parts[2],now=nowISO();
 const need=m=>authorize(admin,m,cfg);
 if(resource==='me')return {email:admin.email,permissions:admin.permissions,local:admin.local,modules:cfg.modules};
 if(resource==='appearance'){need('admins');return appearanceAPI(db,env,admin,method,id,b);}
 if(resource==='settings'){
  need('admins');if(method==='GET')return cfg;
  const allowed=['brand','english_brand','privacy_summary','privacy_body','privacy_version','participation_statement','operating_ready','modules'];
  const patch={};for(const k of allowed)if(b[k]!==undefined){if(k==='operating_ready'){if(typeof b[k]!=='boolean')fail(400,'設定格式錯誤');patch[k]=b[k];}else if(k==='modules'){if(!b[k]||modules.some(m=>typeof b[k][m]!=='boolean')||b[k].admins!==true)fail(400,'模組設定錯誤；管理員模組須保留');patch[k]=b[k];}else patch[k]=text(b[k],k==='privacy_body'?10000:2000);}
  const merged={...cfg,...patch};if(merged.operating_ready&&(!merged.privacy_body.trim()||!merged.privacy_summary.trim()||!merged.participation_statement.trim()||!merged.privacy_version.trim()||merged.privacy_body.includes('【草稿')))fail(400,'請先完成正式個資告知與參與聲明');
  if(['privacy_body','privacy_summary','participation_statement'].some(k=>patch[k]!==undefined&&patch[k]!==cfg[k])&&patch.privacy_version===undefined)fail(400,'告知內容修改時須提供新的版本編號');
  if(['privacy_body','privacy_summary','participation_statement'].some(k=>patch[k]!==undefined&&patch[k]!==cfg[k])&&patch.privacy_version===cfg.privacy_version)fail(400,'告知內容修改時須更新版本');
  await db.batch([...Object.entries(patch).map(([k,v])=>stmt(db,'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,JSON.stringify(v))),audit(db,admin.email,'settings.update','settings',{keys:Object.keys(patch)})]);return {ok:true};
 }
 if(resource==='events'){
  need('events');if(method==='GET')return id?requiredRow(db,'events',id):all(db,`SELECT * FROM events WHERE deleted_at IS ${url.searchParams.get('deleted')==='1'?'NOT NULL':'NULL'} ORDER BY created_at DESC`);
  if(id==='quick'&&method==='POST')return quickEvent(db,admin,b,cfg,(x,o,e)=>sessionInput(x,o,e));
  if(id&&action){const e=await requiredRow(db,'events',id);
   if(action==='hide')return setHidden(db,admin,e,b.hidden);if(action==='delete')return deleteEvent(db,admin,e,b);if(action==='restore')return restoreEvent(db,admin,e);if(action==='duplicate')return duplicateEvent(db,admin,e);fail(404,'找不到 API');}
  if(!id){const eid=uid();const title=text(b.title,200);if(!title)fail(400,'請填活動名稱');await db.batch([stmt(db,'INSERT INTO events(id,title,description,created_at,updated_at) VALUES(?,?,?,?,?)',eid,title,text(b.description||'',10000),now,now),audit(db,admin.email,'event.create',eid)]);return {id:eid};}
  const e=await requiredRow(db,'events',id);if(e.deleted_at)fail(409,'此活動已刪除，請先復原');const status=b.status??e.status;if(!['draft','published','cancelled'].includes(status))fail(400,'活動狀態錯誤');
  const title=text(b.title??e.title,200);if(!title)fail(400,'請填活動名稱');
  await db.batch([stmt(db,'UPDATE events SET title=?,description=?,notes=?,contact=?,status=?,updated_at=? WHERE id=?',title,text(b.description??e.description,10000),text(b.notes??e.notes,3000),text(b.contact??e.contact,500),status,now,id),audit(db,admin.email,'event.update',id,{status})]);return {ok:true};
 }
 if(resource==='sessions'){
  need('events');if(method==='GET')return all(db,sessionQuery+(id?' WHERE s.id=?':url.searchParams.has('event_id')?' WHERE s.event_id=?':'')+' ORDER BY s.starts_at',...(id?[id]:url.searchParams.has('event_id')?[url.searchParams.get('event_id')]:[]));
  const old=id?await requiredRow(db,'event_sessions',id):{};const eid=old.event_id||b.event_id;const e=await requiredRow(db,'events',eid);
  const s=sessionInput(b,old,e);if(s.registration_open&&!cfg.operating_ready)fail(400,'請先完成營運與個資設定');
  const formId=s.form_id||null;if(formId){const f=await one(db,"SELECT id FROM form_versions WHERE id=? AND event_id=? AND status='published'",formId,eid);if(!f)fail(400,'請選擇此活動的已發布表單');}
  if(s.registration_open && !formId && !e.default_form_id)fail(400,'請先發布報名表');
  const sid=id||uid();const rev=id?old.revision+1:1;
  const args=[s.starts_at,s.ends_at,s.timezone,s.location,s.capacity,s.fee,s.fee_type,s.fee_amount,s.fee_note,s.max_seats_per_registration,s.supplies,s.status,s.registration_open,s.opens_at,s.closes_at,formId,s.reminder_enabled,s.reminder_time,s.reminder_at,rev,now];
  const query=id?'UPDATE event_sessions SET starts_at=?,ends_at=?,timezone=?,location=?,capacity=?,fee=?,fee_type=?,fee_amount=?,fee_note=?,max_seats_per_registration=?,supplies=?,status=?,registration_open=?,opens_at=?,closes_at=?,form_id=?,reminder_enabled=?,reminder_time=?,reminder_at=?,revision=?,updated_at=? WHERE id=?':`INSERT INTO event_sessions(starts_at,ends_at,timezone,location,capacity,fee,fee_type,fee_amount,fee_note,max_seats_per_registration,supplies,status,registration_open,opens_at,closes_at,form_id,reminder_enabled,reminder_time,reminder_at,revision,updated_at,id,event_id,created_at) VALUES(${Array(24).fill('?').join(',')})`;
  await db.batch([stmt(db,query,...args,sid,...(id?[]:[eid,now])),audit(db,admin.email,id?'session.update':'session.create',sid,{revision:rev,status:s.status})]);return {id:sid};
 }
 if(resource==='forms'){
  need('events');if(method==='GET')return all(db,'SELECT * FROM form_versions WHERE event_id=? ORDER BY version DESC',url.searchParams.get('event_id'));
  if(!id){const e=await requiredRow(db,'events',b.event_id);const fields=validateFields(b.fields);const fid=uid();await db.batch([
   stmt(db,"INSERT INTO form_versions SELECT ?,?,COALESCE(MAX(version),0)+1,'draft',?,? FROM form_versions WHERE event_id=?",fid,e.id,JSON.stringify(fields),now,e.id),audit(db,admin.email,'form.create',fid)]);return {id:fid};}
  const f=await requiredRow(db,'form_versions',id);if(f.status!=='draft')fail(409,'已發布版本不可覆寫，請建立新版本');
  const fields=validateFields(b.fields||JSON.parse(f.fields_json));
  if(action==='publish'){
   await db.batch([stmt(db,"UPDATE form_versions SET fields_json=?,status='published' WHERE id=? AND status='draft'",JSON.stringify(fields),id),stmt(db,'UPDATE events SET default_form_id=?,updated_at=? WHERE id=?',id,now,f.event_id),audit(db,admin.email,'form.publish',id)]);
  }else await db.batch([stmt(db,"UPDATE form_versions SET fields_json=? WHERE id=? AND status='draft'",JSON.stringify(fields),id),audit(db,admin.email,'form.save',id)]);
  return {ok:true};
 }
 if(resource==='registrations'){
  need(id==='export'||id==='sheet'?'export':'registrations');
  if(id==='sheet'&&method==='GET'){
   const s=await one(db,'SELECT s.id,s.starts_at,s.ends_at,s.location,s.fee,e.id event_id,e.title FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE s.id=?',url.searchParams.get('session_id'));if(!s)fail(404,'找不到場次');
   const regs=await all(db,"SELECT name,seats,name_signature_json,participants_json FROM registrations WHERE session_id=? AND status IN('pending','confirmed') ORDER BY created_at,id",s.id);
   const rows=regs.flatMap(r=>registrationSheetRows(r,s.fee));
   await audit(db,admin.email,'registration.sheet',s.id,{count:rows.length}).run();return {session:s,rows,registrations:regs.length};
  }
  if(method==='GET'){
   const sid=url.searchParams.get('session_id');if(!sid)fail(400,'請選擇場次');
   const rows=await all(db,`SELECT r.*,f.fields_json,c.checked_in_at FROM registrations r JOIN form_versions f ON f.id=r.form_id LEFT JOIN checkins c ON c.registration_id=r.id WHERE r.session_id=? ORDER BY r.created_at,r.id`,sid);
   const status=url.searchParams.get('status'),q=(url.searchParams.get('q')||'').toLowerCase();const filtered=rows.filter(r=>(!status||r.status===status)&&(!q||(r.name+' '+r.email+' '+r.code).toLowerCase().includes(q)));
   if(id==='export'){
    const fields=new Map();for(const r of filtered)for(const f of JSON.parse(r.fields_json))fields.set(f.id,f.label);
    const headings=['報名編號','狀態','參加人數','報名時間','報到時間','表單版本','同意時間','同意版本',...Array.from(fields,([k,v])=>v+' ['+k+']')];
    const csv='\uFEFF'+[headings,...filtered.map(r=>{const a=JSON.parse(r.answers_json);return [r.code,r.status,r.seats,r.created_at,r.checked_in_at,r.form_id,r.consent_at,r.consent_version,...Array.from(fields.keys(),k=>a[k]??'')];})].map(row=>row.map(csvCell).join(',')).join('\r\n');
    await audit(db,admin.email,'registration.export',sid,{count:filtered.length}).run();return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="registrations.csv"'}});
   }
   return filtered;
  }
  if(!id&&method==='POST')return addRegistration(db,admin,b,cfg);
  if(action==='purge'&&method==='POST')return purgeRegistration(db,admin,await requiredRow(db,'registrations',id));
  const r=await requiredRow(db,'registrations',id);if(!['pending','confirmed','waitlisted','cancelled'].includes(b.status))fail(400,'報名狀態錯誤');
  if(r.status==='cancelled'&&b.status!=='cancelled')fail(409,'取消的報名須由參加者重新提交，以更新同意紀錄');
  await db.batch([stmt(db,'UPDATE registrations SET status=?,updated_at=? WHERE id=?',b.status,now,id),audit(db,admin.email,'registration.status',id,{from:r.status,to:b.status})]);return {ok:true};
 }
 if(resource==='checkins')return checkinAPI(db,admin,url,method,id,action,b,now,need);
 if(resource==='stats'){if(id==='export'){need('export');const data=await stats(db,url);await audit(db,admin.email,'stats.export','stats',{year:data.year}).run();return new Response(statsCSV(data),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="event-stats.csv"'}});}need('events');return stats(db,url);}
 if(resource==='site-images'){need('photos');if(method!=='POST'||id)fail(405,'不支援此方法');return uploadSiteImage(req,env,admin,url);}
 if(resource==='banners'){need('photos');return bannersAPI(req,env,admin,url,method,id,action,b);}
 if(resource==='about'){need('events');if(method!=='GET'&&method!=='PUT')fail(405,'不支援此方法');return aboutAPI(db,admin,method,b);}
 if(resource==='feedback')return feedbackAdmin(req,env,admin,url,parts,b,need);
 if(resource==='photos'){
  need('photos');if(method==='GET'){if(action==='media')return media(req,env,id,true);return all(db,'SELECT * FROM event_photos WHERE event_id=? ORDER BY sort_order,created_at',url.searchParams.get('event_id'));}
  if(!id)return uploadPhoto(req,env,admin,url);if(action==='thumbnail')return thumbnail(req,env,admin,id);return updatePhoto(b,env,admin,id);
 }
 if(resource==='notifications'){
  need('notifications');if(method==='GET'){
   if(id==='templates')return all(db,'SELECT * FROM email_templates t WHERE version=(SELECT MAX(version) FROM email_templates WHERE kind=t.kind) ORDER BY kind');
   if(id==='logs')return all(db,'SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 200');
   return all(db,"SELECT j.id,j.registration_id,j.session_id,j.kind,j.due_at,j.status,j.attempts,j.provider_id,j.last_error,j.created_at,j.updated_at,r.name AS recipient_name,COALESCE(r.email,json_extract(j.payload_json,'$.to[0]')) AS recipient_email,r.seats,s.starts_at AS session_starts_at,e.title AS event_title FROM email_jobs j LEFT JOIN registrations r ON r.id=j.registration_id LEFT JOIN event_sessions s ON s.id=COALESCE(j.session_id,r.session_id) LEFT JOIN events e ON e.id=s.event_id ORDER BY j.created_at DESC LIMIT 200");
  }
  await rateLimit(req,env,'notifications',15);
  if(id==='templates'){validateTemplate(b.subject,b.body);if(!['receipt','confirmation','reminder','reschedule','cancellation','test'].includes(b.kind))fail(400,'通知類型錯誤');await db.batch([stmt(db,'INSERT INTO email_templates SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,? FROM email_templates WHERE kind=?',uid(),b.kind,b.subject,b.body,now,b.kind),audit(db,admin.email,'template.update',b.kind)]);return {ok:true};}
  if(id==='preview'){
   const job=await requiredRow(db,'email_jobs',b.job_id);const payload=job.payload_json?JSON.parse(job.payload_json):await payloadFor(db,job,env,{preview:true});return payload?{subject:payload.subject,text:payload.text,html:payload.html}:{subject:'',text:'找不到收件資料'};
  }
  if(id==='test'){
   if(!emailValid(b.email))fail(400,'請填有效測試 Email');const tpl=await one(db,"SELECT * FROM email_templates WHERE kind=? ORDER BY version DESC LIMIT 1",b.kind||'test');if(!tpl)fail(400,'範本不存在');
   const payload={from:env.MAIL_FROM||'mock@community-events.test',to:[normalizeEmail(b.email)],...renderTemplate(tpl,{name:'測試參加者',event_name:'通知服務示範活動（測試）',date:'示範時間（非正式場次）',location:'測試地點',code:'TEST',status:'待確認',seats:2,notes:'測試內容',contact:'測試聯絡方式'},{replyTo:env.MAIL_REPLY_TO})};
   const jid=uid();await db.batch([stmt(db,'INSERT INTO email_jobs(id,kind,unique_key,due_at,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',jid,'test','test:'+jid,now,JSON.stringify(payload),now,now),audit(db,admin.email,'email.test',jid)]);return {id:jid};
  }
  if(id==='process')return processJobs(env);
  if(id==='broadcast'){
   const s=await requiredRow(db,'event_sessions',b.session_id);if(!['reschedule','cancellation'].includes(b.kind))fail(400,'通知類型錯誤');if(b.kind==='cancellation'&&s.status!=='cancelled'&&(await requiredRow(db,'events',s.event_id)).status!=='cancelled')fail(400,'請先取消活動或場次');
   const operation=uid();await db.batch([stmt(db,`INSERT INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at) SELECT lower(hex(randomblob(16))),id,session_id,?,?||':'||id,?,?,? FROM registrations WHERE session_id=? AND status<>'cancelled'`,b.kind,operation,now,now,now,s.id),audit(db,admin.email,'email.broadcast',s.id,{kind:b.kind,operation})]);return {ok:true};
  }
  if(action==='resend'){
   const old=await requiredRow(db,'email_jobs',id);if(feedbackKinds.includes(old.kind))fail(409,'課程回饋信請到「課程回饋」頁面重試或寄送提醒');if(['unknown','processing','pending'].includes(old.status))fail(409,'寄送結果不明或仍在處理，請先向供應商核對');
   const jid=uid();await db.batch([stmt(db,'INSERT INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',jid,old.registration_id,old.session_id,old.kind,'manual:'+jid,now,null,now,now),audit(db,admin.email,'email.resend',id,{newJob:jid})]);return {id:jid};
  }
  if(action==='resolve'){
   const job=await requiredRow(db,'email_jobs',id);if(job.status!=='unknown')fail(409,'只有結果不明的任務可人工核對');if(!['accepted','delivered','failed','bounced'].includes(b.status))fail(400,'請提供核對結果');
   await db.batch([stmt(db,"UPDATE email_jobs SET status=?,provider_id=?,updated_at=? WHERE id=? AND status='unknown'",b.status,text(b.provider_id||'',200)||null,now,id),audit(db,admin.email,'email.resolve',id,{status:b.status})]);return {ok:true};
  }
 }
 if(resource==='admins'){
  need('admins');if(method==='GET')return all(db,'SELECT * FROM admin_permissions ORDER BY email,module');
  if(!emailValid(b.email)||!Array.isArray(b.permissions)||b.permissions.some(m=>!modules.includes(m)))fail(400,'管理員或權限格式錯誤');
  const email=normalizeEmail(b.email);if(email===admin.email&&!b.permissions.includes('admins'))fail(400,'不能移除自己的管理員管理權限');
  const managers=await all(db,"SELECT DISTINCT email FROM admin_permissions WHERE module='admins'");if(managers.length===1&&managers[0].email===email&&!b.permissions.includes('admins'))fail(400,'須保留至少一位系統管理員');
  await db.batch([stmt(db,'DELETE FROM admin_permissions WHERE email=?',email),...b.permissions.map(m=>stmt(db,'INSERT INTO admin_permissions VALUES(?,?)',email,m)),audit(db,admin.email,'admin.permissions',email,{permissions:b.permissions})]);return {ok:true};
 }
 if(resource==='audit'){need('admins');return all(db,'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');}
 fail(404,'找不到 API');
}
