// Organizer tools added for the template: fees, quick event creation, hide/delete, organizer-entered registrations,
// statistics, site images, home banners, the block-based About page and the public calendar file.
import {fail,uid,nowISO,stmt,one,all,settings,audit,text,normalizeEmail,emailValid,validateFields,csvCell,readLimited,hash} from './lib.js';
import {imageInfo} from './photos.js';
import {sessionICS} from './calendar.js';
import {site,siteURL} from './site.js';
import {themes} from './themes.js';
import {themeCSS,resolvePalette,paletteProblems,contrastReport,isHex,paletteKeys} from './theme-css.js';


// ---------- Fees ----------
export function feeInput(b,old={}){
 const type=b.fee_type??old.fee_type??(old.fee==='免費'?'free':old.fee&&old.fee!=='待定'?'paid':'tbd');
 if(!['free','paid','tbd'].includes(type))fail(400,'收費方式錯誤');
 let amount=b.fee_amount!==undefined?b.fee_amount:old.fee_amount??null;
 if(type==='paid'){if(amount===''||amount===null||!Number.isInteger(Number(amount))||Number(amount)<0||Number(amount)>1000000)fail(400,'收費金額須為 0–1000000 的整數');amount=Number(amount);}else amount=null;
 const note=text(b.fee_note??old.fee_note??'',200);
 return {fee_type:type,fee_amount:amount,fee_note:note,fee:feeText(type,amount,note)};
}
export function feeText(type,amount,note=''){
 const base=type==='free'?'免費':type==='paid'?`每人 ${Number(amount).toLocaleString('zh-TW')} 元`:'待定';
 return note&&type!=='tbd'?`${base}（${note}）`:base;
}
export function seatLimitInput(v,old){
 const n=v===undefined||v===null||v===''?(old??10):Number(v);
 if(!Number.isInteger(n)||n<1||n>100000)fail(400,'每筆報名人數上限須為 1–100000');return n;
}

// ---------- Standard registration form used by the quick-create wizard ----------
export function standardFields(maxSeats=10){
 return validateFields([
  {id:'name',type:'text',label:'姓名',required:true,enabled:true,maxLength:50,placeholder:'請填寫真實姓名'},
  {id:'email',type:'text',label:'電子郵件',required:true,enabled:true,maxLength:254,help:'用來寄送報名狀態與活動提醒。'},
  {id:'phone',type:'text',label:'聯絡電話',required:false,enabled:true,maxLength:30,help:'活動異動時聯絡用，可留空。'},
  {id:'participant_count',type:'number',label:'參加人數（含自己）',required:true,enabled:true,min:1,max:maxSeats,help:'名額依實際參加人數計算。'}
 ]);
}

// ---------- Events: quick create, duplicate, hide, delete, restore ----------
export async function quickEvent(db,admin,b,cfg,sessionInput){
 const now=nowISO(),eid=uid(),fid=uid(),sid=uid();
 const event={title:text(b.title,200),description:text(b.description||'',10000),notes:text(b.notes||'',3000),contact:text(b.contact||'',500)};
 if(!event.title)fail(400,'請填活動名稱');
 const open=b.open===true;
 if(open&&!cfg.operating_ready)fail(400,'請先到「設定」完成正式個資告知，並開啟營運狀態，才能開放報名');
 const s=sessionInput({...b.session,status:'published',registration_open:open},{},event);
 const fields=Array.isArray(b.fields)?validateFields(b.fields):standardFields(s.max_seats_per_registration);
 await db.batch([
  stmt(db,'INSERT INTO events(id,title,description,notes,contact,status,default_form_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',eid,event.title,event.description,event.notes,event.contact,open?'published':'draft',fid,now,now),
  stmt(db,"INSERT INTO form_versions VALUES(?,?,1,'published',?,?)",fid,eid,JSON.stringify(fields),now),
  stmt(db,'INSERT INTO event_sessions(id,event_id,starts_at,ends_at,timezone,location,capacity,fee,fee_type,fee_amount,fee_note,max_seats_per_registration,supplies,status,registration_open,opens_at,closes_at,form_id,reminder_enabled,reminder_time,reminder_at,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',sid,eid,s.starts_at,s.ends_at,s.timezone,s.location,s.capacity,s.fee,s.fee_type,s.fee_amount,s.fee_note,s.max_seats_per_registration,s.supplies,s.status,s.registration_open,s.opens_at,s.closes_at,null,s.reminder_enabled,s.reminder_time,s.reminder_at,now,now),
  audit(db,admin.email,'event.quick_create',eid,{session:sid,open})
 ]);
 return {id:eid,session_id:sid,form_id:fid};
}
export async function duplicateEvent(db,admin,e){
 const now=nowISO(),eid=uid();const form=e.default_form_id?await one(db,'SELECT fields_json FROM form_versions WHERE id=?',e.default_form_id):null;const fid=form?uid():null;
 const last=await one(db,'SELECT * FROM event_sessions WHERE event_id=? ORDER BY starts_at DESC LIMIT 1',e.id);
 await db.batch([
  stmt(db,"INSERT INTO events(id,title,description,notes,contact,status,default_form_id,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?)",eid,(e.title+'（複本）').slice(0,200),e.description,e.notes,e.contact,fid,now,now),
  ...(form?[stmt(db,"INSERT INTO form_versions VALUES(?,?,1,'published',?,?)",fid,eid,form.fields_json,now)]:[]),
  audit(db,admin.email,'event.duplicate',eid,{from:e.id})
 ]);
 return {id:eid,session_template:last?{location:last.location,capacity:last.capacity,fee_type:last.fee_type,fee_amount:last.fee_amount,fee_note:last.fee_note,max_seats_per_registration:last.max_seats_per_registration,supplies:last.supplies}:null};
}
export async function setHidden(db,admin,e,hidden){
 if(typeof hidden!=='boolean')fail(400,'請指定是否隱藏');
 await db.batch([stmt(db,'UPDATE events SET hidden=?,updated_at=? WHERE id=?',hidden?1:0,nowISO(),e.id),audit(db,admin.email,hidden?'event.hide':'event.unhide',e.id)]);return {ok:true};
}
export async function deleteEvent(db,admin,e,b){
 if(e.deleted_at)fail(409,'此活動已刪除');
 if(typeof b.confirm_title!=='string'||b.confirm_title.trim()!==e.title.trim())fail(400,'請輸入完整活動名稱以確認刪除');
 const now=nowISO();
 if(e.status!=='cancelled'){
  const active=await one(db,"SELECT COUNT(*) n FROM registrations r JOIN event_sessions s ON s.id=r.session_id WHERE s.event_id=? AND s.status<>'cancelled' AND s.ends_at>? AND r.status IN('pending','confirmed')",e.id,now);
  if(active.n)fail(409,`尚有 ${active.n} 筆未結束場次的有效報名。請先將活動狀態改為「已取消」並寄出取消通知，再刪除`);
 }
 await db.batch([stmt(db,'UPDATE events SET deleted_at=?,updated_at=? WHERE id=?',now,now,e.id),stmt(db,'UPDATE event_sessions SET registration_open=0,updated_at=? WHERE event_id=?',now,e.id),audit(db,admin.email,'event.delete',e.id)]);
 return {ok:true};
}
export async function restoreEvent(db,admin,e){
 if(!e.deleted_at)fail(409,'此活動未刪除');
 await db.batch([stmt(db,'UPDATE events SET deleted_at=NULL,hidden=1,updated_at=? WHERE id=?',nowISO(),e.id),audit(db,admin.email,'event.restore',e.id)]);
 return {ok:true,hidden:true};
}

// ---------- Organizer-entered registrations ----------
export async function addRegistration(db,admin,b,cfg){
 if(typeof b.submission_id!=='string'||!/^[a-f0-9-]{36}$/i.test(b.submission_id))fail(400,'提交識別格式錯誤');
 const retry=await one(db,'SELECT id,code,status,seats,created_by_admin FROM registrations WHERE submission_id=?',b.submission_id);
 if(retry){if(!retry.created_by_admin)fail(409,'提交識別已使用');return {id:retry.id,code:retry.code,status:retry.status,seats:retry.seats};}
 if(b.consent_confirmed!==true)fail(400,'請確認已取得當事人同意提供個人資料');
 const s=await one(db,"SELECT s.*,COALESCE(s.form_id,e.default_form_id) active_form_id,e.status event_status,e.deleted_at FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE s.id=?",b.session_id);
 if(!s)fail(404,'找不到場次');
 const now=nowISO();
 if(s.status!=='published'||s.event_status!=='published'||s.deleted_at)fail(409,'場次或活動尚未發布，無法新增報名');
 if(s.ends_at<=now)fail(409,'場次已結束，無法新增報名');
 if(!s.active_form_id)fail(409,'此活動尚未發布報名表');
 const name=text(b.name||'',50);if(!name)fail(400,'請填寫姓名');
 const rawEmail=normalizeEmail(b.email);if(rawEmail&&!emailValid(rawEmail))fail(400,'Email 格式錯誤');
 const phone=text(b.phone||'',30);const seats=Number(b.seats||1);
 if(!Number.isInteger(seats)||seats<1||seats>100000)fail(400,'參加人數須為 1–100000');
 const status=b.status||'confirmed';if(!['pending','confirmed','waitlisted'].includes(status))fail(400,'報名狀態錯誤');
 const rid=uid(),code='DN-'+uid().slice(0,8).toUpperCase();
 const normalized=rawEmail||`no-email:${rid}`;
 if(rawEmail){const dup=await one(db,'SELECT status FROM registrations WHERE session_id=? AND normalized_email=?',s.id,rawEmail);if(dup)fail(409,dup.status==='cancelled'?'此 Email 在本場次有已取消的報名，請請對方重新報名或先刪除舊紀錄':'此 Email 已報名此場次');}
 const answers={name,email:rawEmail,participant_count:seats,...(phone?{phone}:{})};
 const consent={admin_attested:true,attested_by:admin.email,privacy_version:cfg.privacy_version};
 const fallback=b.waitlist_if_full===true&&status!=='waitlisted';
 const statusSQL=fallback?`CASE WHEN ?+(SELECT COALESCE(SUM(seats),0) FROM registrations WHERE session_id=? AND status IN('pending','confirmed'))<=(SELECT capacity FROM event_sessions WHERE id=?) THEN ? ELSE 'waitlisted' END`:'?';
 const statusArgs=fallback?[seats,s.id,s.id,status]:[status];
 const statements=[
  stmt(db,`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,answers_json,consent_at,consent_version,consent_json,submission_id,seats,status,created_at,updated_at,registration_source,created_by_admin) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,${statusSQL},?,?,'online',?`,rid,s.id,code,name,rawEmail,normalized,s.active_form_id,JSON.stringify(answers),now,cfg.privacy_version+':admin-entered',JSON.stringify(consent),b.submission_id,seats,...statusArgs,now,now,admin.email),
  ...(b.notify===false||!rawEmail?[stmt(db,"UPDATE email_jobs SET status='cancelled',updated_at=? WHERE registration_id=? AND status='pending'",now,rid)]:[]),
  audit(db,admin.email,'registration.admin_create',rid,{session:s.id,seats,status,notify:b.notify!==false&&!!rawEmail})
 ];
 try{await db.batch(statements);}
 catch(error){const saved=await one(db,'SELECT id,code,status,seats FROM registrations WHERE submission_id=? AND created_by_admin IS NOT NULL',b.submission_id);if(saved)return saved;throw error;}
 return one(db,'SELECT id,code,status,seats FROM registrations WHERE id=?',rid);
}
// Permanently removes one cancelled registration and everything that points at it. Audit keeps only the id.
export async function purgeRegistration(db,admin,r){
 if(r.status!=='cancelled')fail(409,'只能刪除已取消的報名；請先將狀態改為「已取消」');
 const id=r.id;
 await db.batch([
  stmt(db,'DELETE FROM email_logs WHERE job_id IN (SELECT id FROM email_jobs WHERE registration_id=?)',id),
  stmt(db,'DELETE FROM email_jobs WHERE registration_id=?',id),
  stmt(db,'DELETE FROM checkin_attendee_details WHERE registration_id=?',id),
  stmt(db,'DELETE FROM checkin_attendees WHERE registration_id=?',id),
  stmt(db,'DELETE FROM checkins WHERE registration_id=?',id),
  stmt(db,'DELETE FROM feedback_invitations WHERE registration_id=?',id),
  stmt(db,'DELETE FROM registrations WHERE id=?',id),
  audit(db,admin.email,'registration.purge',id)
 ]);
 return {ok:true};
}

// ---------- Statistics (people counts, not registration rows) ----------
export async function stats(db,url){
 const year=url.searchParams.get('year')||'';if(year&&!/^\d{4}$/.test(year))fail(400,'年份格式錯誤');
 const rows=await all(db,`SELECT e.id event_id,e.title,e.hidden,s.id session_id,s.starts_at,s.status,s.capacity,
  COALESCE(SUM(CASE WHEN r.status IN('pending','confirmed') THEN r.seats END),0) registered_people,
  COALESCE(SUM(CASE WHEN r.status='confirmed' THEN r.seats END),0) confirmed_people,
  COALESCE(SUM(CASE WHEN r.status='pending' THEN r.seats END),0) pending_people,
  COALESCE(SUM(CASE WHEN r.status='waitlisted' THEN r.seats END),0) waitlisted_people,
  COUNT(CASE WHEN r.status='cancelled' THEN 1 END) cancelled_registrations,
  COUNT(CASE WHEN r.status IN('pending','confirmed') THEN 1 END) registrations,
  (SELECT COUNT(*) FROM checkins c WHERE c.session_id=s.id) checked_in_registrations,
  (SELECT COUNT(*) FROM checkin_attendees a JOIN checkins c ON c.registration_id=a.registration_id WHERE c.session_id=s.id) attended_people
  FROM event_sessions s JOIN events e ON e.id=s.event_id LEFT JOIN registrations r ON r.session_id=s.id
  WHERE e.deleted_at IS NULL ${year?"AND substr(datetime(s.starts_at,'+8 hours'),1,4)=?":''}
  GROUP BY s.id ORDER BY s.starts_at DESC`,...(year?[year]:[]));
 const sum=k=>rows.reduce((n,r)=>n+(r[k]||0),0);
 const totals={sessions:rows.length,events:new Set(rows.map(r=>r.event_id)).size,registered_people:sum('registered_people'),confirmed_people:sum('confirmed_people'),pending_people:sum('pending_people'),waitlisted_people:sum('waitlisted_people'),cancelled_registrations:sum('cancelled_registrations'),attended_people:sum('attended_people')};
 const years=(await all(db,"SELECT DISTINCT substr(datetime(starts_at,'+8 hours'),1,4) y FROM event_sessions ORDER BY y DESC")).map(r=>r.y);
 return {year:year||null,years,totals,sessions:rows};
}
export function statsCSV(data){
 const head=['活動','場次開始','場次狀態','名額','有效報名人次（待確認＋已確認）','已確認人次','待確認人次','候補人次','取消筆數','報到筆數','實際出席人次'];
 const body=data.sessions.map(r=>[r.title,r.starts_at,r.status,r.capacity,r.registered_people,r.confirmed_people,r.pending_people,r.waitlisted_people,r.cancelled_registrations,r.checked_in_registrations,r.attended_people]);
 return '﻿'+[head,...body].map(row=>row.map(csvCell).join(',')).join('\r\n');
}

// ---------- Site images (banners, About page) ----------
export async function uploadSiteImage(req,env,admin,url){
 const bytes=await readLimited(req,Number(env.MAX_PHOTO_BYTES||8388608));const info=imageInfo(bytes);const max=Number(env.MAX_PHOTO_DIMENSION||6000);
 if(info.width>max||info.height>max)fail(400,`圖片尺寸不得超過 ${max}px`);
 const id=uid(),key=`site/${id}`,now=nowISO(),alt=text(url.searchParams.get('alt')||'',300);
 await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:info.mime}});
 try{await env.DB.batch([stmt(env.DB,'INSERT INTO site_images(id,object_key,mime,size,width,height,alt,created_at) VALUES(?,?,?,?,?,?,?,?)',id,key,info.mime,bytes.length,info.width,info.height,alt,now),audit(env.DB,admin.email,'site_image.upload',id)]);}catch(e){await env.PHOTOS.delete(key);throw e;}
 return {id,...info};
}
export async function siteImageMedia(env,id){
 const img=await one(env.DB,'SELECT * FROM site_images WHERE id=?',id);if(!img)return null;
 const object=await env.PHOTOS.get(img.object_key);if(!object)fail(404,'檔案不存在');
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||img.mime,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
}
async function imageReferenced(db,id,exceptBanner){
 if(await one(db,'SELECT 1 FROM banners WHERE image_id=? AND id<>?',id,exceptBanner||''))return true;
 const about=await one(db,"SELECT value FROM settings WHERE key='about_blocks'");return !!about&&about.value.includes(`"${id}"`);
}

// ---------- Home page banners ----------
const isoOrNull=v=>{if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail(400,'上架期間日期格式錯誤');return new Date(v).toISOString();};
function linkInput(v){if(v===undefined||v===null||v==='')return null;const s=text(v,500);if(!/^(https:\/\/|\/)/.test(s)||/^\/\//.test(s))fail(400,'連結須為 https:// 開頭或站內路徑（/ 開頭）');return s;}
async function bannerInput(db,b,old={}){
 const out={title:text(b.title??old.title??'',200),subtitle:text(b.subtitle??old.subtitle??'',300),alt:text(b.alt??old.alt??'',300),link_url:b.link_url!==undefined?linkInput(b.link_url):old.link_url??null,event_id:b.event_id!==undefined?(b.event_id||null):old.event_id??null,status:b.status??old.status??'hidden',starts_at:b.starts_at!==undefined?isoOrNull(b.starts_at):old.starts_at??null,ends_at:b.ends_at!==undefined?isoOrNull(b.ends_at):old.ends_at??null,image_id:b.image_id??old.image_id};
 if(!out.alt)fail(400,'請填寫圖片替代文字（給看不到圖片的使用者）');
 if(!['published','hidden'].includes(out.status))fail(400,'Banner 狀態錯誤');
 if(out.starts_at&&out.ends_at&&out.ends_at<=out.starts_at)fail(400,'下架時間須晚於上架時間');
 if(!out.image_id||!await one(db,'SELECT id FROM site_images WHERE id=?',out.image_id))fail(400,'請先上傳 Banner 圖片');
 if(out.event_id&&!await one(db,'SELECT id FROM events WHERE id=? AND deleted_at IS NULL',out.event_id))fail(400,'連結的活動不存在');
 return out;
}
export async function bannersAPI(req,env,admin,url,method,id,action,b){
 const db=env.DB,now=nowISO();
 if(method==='GET')return all(db,'SELECT b.*,i.width,i.height FROM banners b JOIN site_images i ON i.id=b.image_id ORDER BY b.sort_order,b.created_at');
 if(!id){const x=await bannerInput(db,b);const bid=uid();const order=(await one(db,'SELECT COALESCE(MAX(sort_order),0)+1 n FROM banners')).n;
  await db.batch([stmt(db,'INSERT INTO banners(id,image_id,title,subtitle,alt,event_id,link_url,sort_order,status,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',bid,x.image_id,x.title,x.subtitle,x.alt,x.event_id,x.link_url,order,x.status,x.starts_at,x.ends_at,now,now),audit(db,admin.email,'banner.create',bid)]);return {id:bid};}
 const old=await one(db,'SELECT * FROM banners WHERE id=?',id);if(!old)fail(404,'找不到 Banner');
 if(action==='move'){
  if(!['up','down'].includes(b.direction))fail(400,'請指定移動方向');
  const list=await all(db,'SELECT id FROM banners ORDER BY sort_order,created_at');const i=list.findIndex(x=>x.id===id),j=b.direction==='up'?i-1:i+1;
  if(j<0||j>=list.length)return {ok:true};[list[i],list[j]]=[list[j],list[i]];
  await db.batch([...list.map((x,n)=>stmt(db,'UPDATE banners SET sort_order=? WHERE id=?',n+1,x.id)),audit(db,admin.email,'banner.move',id,{direction:b.direction})]);return {ok:true};
 }
 if(action==='delete'){
  const keep=await imageReferenced(db,old.image_id,id);const img=await one(db,'SELECT object_key FROM site_images WHERE id=?',old.image_id);
  await db.batch([stmt(db,'DELETE FROM banners WHERE id=?',id),...(keep?[]:[stmt(db,'DELETE FROM site_images WHERE id=?',old.image_id)]),audit(db,admin.email,'banner.delete',id,{image_removed:!keep})]);
  if(!keep&&img){await env.PHOTOS.delete(img.object_key);}
  return {ok:true};
 }
 if(action)fail(404,'找不到 API');
 const x=await bannerInput(db,b,old);
 await db.batch([stmt(db,'UPDATE banners SET image_id=?,title=?,subtitle=?,alt=?,event_id=?,link_url=?,status=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?',x.image_id,x.title,x.subtitle,x.alt,x.event_id,x.link_url,x.status,x.starts_at,x.ends_at,now,id),audit(db,admin.email,'banner.update',id,{status:x.status})]);
 return {ok:true};
}
export async function publicBanners(db){
 const now=nowISO();
 return all(db,`SELECT b.id,b.image_id,b.title,b.subtitle,b.alt,b.event_id,b.link_url,i.width,i.height FROM banners b JOIN site_images i ON i.id=b.image_id LEFT JOIN events e ON e.id=b.event_id
  WHERE b.status='published' AND (b.starts_at IS NULL OR b.starts_at<=?) AND (b.ends_at IS NULL OR b.ends_at>?)
  AND (b.event_id IS NULL OR (e.status='published' AND e.hidden=0 AND e.deleted_at IS NULL)) ORDER BY b.sort_order,b.created_at`,now,now);
}

// ---------- Block-based About page ----------
const tones=['plain','tinted','accent'],aligns=['left','center'];
const blockText=(v,max,label)=>{if(v===undefined||v===null)return '';if(typeof v!=='string'||v.length>max)fail(400,`${label}最多 ${max} 字`);return v.trim();};
function aboutLink(v){const s=blockText(v,500,'連結');if(!s)return '';if(!/^(https:\/\/|\/|mailto:|tel:)/.test(s)||/^\/\//.test(s))fail(400,'連結須為 https://、/、mailto: 或 tel: 開頭');return s;}
export async function validateAbout(db,blocks){
 if(!Array.isArray(blocks)||blocks.length>30)fail(400,'區塊數量須為 0–30');
 const out=[];
 for(const [n,raw] of blocks.entries()){
  if(!raw||typeof raw!=='object')fail(400,`第 ${n+1} 個區塊格式錯誤`);
  const b={type:raw.type,tone:tones.includes(raw.tone)?raw.tone:'plain',align:aligns.includes(raw.align)?raw.align:'left'};
  if(raw.type==='hero'){b.title=blockText(raw.title,120,'標題');b.text=blockText(raw.text,600,'說明');if(!b.title)fail(400,`第 ${n+1} 個區塊（主標題）請填標題`);}
  else if(raw.type==='text'){b.heading=blockText(raw.heading,120,'標題');b.body=blockText(raw.body,5000,'內文');if(!b.heading&&!b.body)fail(400,`第 ${n+1} 個區塊（文字）不可空白`);}
  else if(raw.type==='cards'){b.heading=blockText(raw.heading,120,'標題');b.columns=[2,3,4].includes(raw.columns)?raw.columns:3;
   if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>12)fail(400,`第 ${n+1} 個區塊（卡片）須有 1–12 張卡片`);
   b.items=raw.items.map(i=>({title:blockText(i?.title,80,'卡片標題'),text:blockText(i?.text,400,'卡片內容')})).filter(i=>i.title||i.text);}
  else if(raw.type==='image_text'){b.heading=blockText(raw.heading,120,'標題');b.body=blockText(raw.body,3000,'內文');b.image_side=raw.image_side==='right'?'right':'left';b.alt=blockText(raw.alt,300,'圖片說明');
   if(typeof raw.image_id!=='string'||!await one(db,'SELECT id FROM site_images WHERE id=?',raw.image_id))fail(400,`第 ${n+1} 個區塊（圖文）請上傳圖片`);b.image_id=raw.image_id;
   if(!b.alt)fail(400,`第 ${n+1} 個區塊（圖文）請填圖片說明`);}
  else if(raw.type==='links'){b.heading=blockText(raw.heading,120,'標題');
   if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>12)fail(400,`第 ${n+1} 個區塊（連結）須有 1–12 個連結`);
   b.items=raw.items.map(i=>({label:blockText(i?.label,80,'連結名稱'),note:blockText(i?.note,160,'連結說明'),url:aboutLink(i?.url)})).filter(i=>i.label&&i.url);
   if(!b.items.length)fail(400,`第 ${n+1} 個區塊（連結）請填連結名稱與網址`);}
  else if(raw.type==='contact'){b.heading=blockText(raw.heading,120,'標題');b.body=blockText(raw.body,1000,'聯絡資訊');if(!b.body)fail(400,`第 ${n+1} 個區塊（聯絡資訊）不可空白`);}
  else fail(400,`第 ${n+1} 個區塊類型不支援`);
  out.push(b);
 }
 return out;
}
export async function aboutAPI(db,admin,method,b){
 if(method==='GET'){const cfg=await settings(db);return {blocks:cfg.about_blocks??null,fallback:defaultAbout()};}
 const blocks=await validateAbout(db,b.blocks);
 await db.batch([stmt(db,"INSERT INTO settings VALUES('about_blocks',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(blocks)),audit(db,admin.email,'about.update','about',{blocks:blocks.length})]);
 return {ok:true,blocks};
}
// Default About blocks come from site.config.json until an organizer saves their own.
export function defaultAbout(){
 const a=site.about||{};const paragraphs=Array.isArray(a.paragraphs)?a.paragraphs.filter(p=>typeof p==='string'):[];
 return [{type:'hero',tone:'accent',align:'left',title:a.title||'關於我們',text:site.tagline||''},...(paragraphs.length?[{type:'text',tone:'plain',align:'left',heading:site.communityName,body:paragraphs.join('\n\n')}]:[]),...(a.contact?[{type:'contact',tone:'tinted',align:'left',heading:'聯絡我們',body:a.contact}]:[])];
}
export async function publicAbout(db){
 const cfg=await settings(db);const blocks=Array.isArray(cfg.about_blocks)?cfg.about_blocks:defaultAbout();
 const ids=blocks.filter(b=>b.type==='image_text').map(b=>b.image_id);
 const dims=ids.length?Object.fromEntries((await all(db,`SELECT id,width,height FROM site_images WHERE id IN (${ids.map(()=>'?').join(',')})`,...ids)).map(r=>[r.id,r])):{};
 return {blocks:blocks.map(b=>b.type==='image_text'?{...b,width:dims[b.image_id]?.width||null,height:dims[b.image_id]?.height||null}:b)};
}

// ---------- Public calendar file ----------
export async function calendarFile(env,id,origin){
 const s=await one(env.DB,"SELECT s.id,s.event_id,s.starts_at,s.ends_at,s.location,s.fee,s.supplies,s.status,s.revision,e.title FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE s.id=? AND s.status IN('published','cancelled') AND e.status IN('published','cancelled') AND e.hidden=0 AND e.deleted_at IS NULL",id);
 if(!s)fail(404,'找不到場次');
 const base=siteURL(env,origin);let host='community-events';try{host=new URL(base).hostname||host;}catch{}
 return new Response(sessionICS(s,{siteUrl:base,host}),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename="event-${encodeURIComponent(s.id).slice(0,60)}.ics"`,'Cache-Control':'no-store'}});
}

// ---------- Appearance: site colors and icon (settings 'theme' and 'site_icon') ----------
const savedTheme=cfg=>cfg.theme??site.theme;
function themeInput(v){
 if(typeof v==='string'){if(!themes.some(t=>t.id===v))fail(400,'不支援的網站配色');return v;}
 if(!v||typeof v!=='object'||v.id!=='custom')fail(400,'配色格式錯誤');
 for(const k of paletteKeys)if(!isHex(v[k]))fail(400,'自訂配色須為 #RRGGBB 色碼');
 const p=Object.fromEntries(paletteKeys.map(k=>[k,v[k].toLowerCase()]));const problems=paletteProblems(p);
 if(problems.length)fail(400,'這組顏色對比不足，住戶可能看不清楚文字',{palette:problems.join('；')});
 return {id:'custom',...p};
}
async function iconInput(db,id,size){
 const img=await one(db,'SELECT * FROM site_images WHERE id=?',id);
 if(!img||img.mime!=='image/png'||img.width!==size||img.height!==size)fail(400,`網站圖示須為 ${size}×${size} 的 PNG`);return id;
}
async function dropIcon(env,icon){
 for(const id of [icon?.icon,icon?.apple].filter(Boolean)){
  if(await imageReferenced(env.DB,id))continue;const img=await one(env.DB,'SELECT object_key FROM site_images WHERE id=?',id);
  await env.DB.batch([stmt(env.DB,'DELETE FROM site_images WHERE id=?',id)]);if(img)await env.PHOTOS.delete(img.object_key);
 }
}
export async function appearanceAPI(db,env,admin,method,action,b){
 const cfg=await settings(db);
 if(method==='GET')return {theme:savedTheme(cfg)??themes[0].id,palette:resolvePalette(savedTheme(cfg)),presets:themes.map(t=>({...t,contrast:contrastReport(t)})),icon:cfg.site_icon||null};
 if(method!=='PUT'&&method!=='POST')fail(405,'不支援此方法');
 if(action==='icon'){
  const old=cfg.site_icon||null;
  if(b.reset===true){await db.batch([stmt(db,"DELETE FROM settings WHERE key='site_icon'"),audit(db,admin.email,'appearance.icon_reset','site_icon')]);await dropIcon(env,old);return {ok:true,icon:null};}
  const icon={icon:await iconInput(db,b.icon_id,512),apple:await iconInput(db,b.apple_id,180)};
  await db.batch([stmt(db,"INSERT INTO settings VALUES('site_icon',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(icon)),audit(db,admin.email,'appearance.icon','site_icon')]);
  if(old)await dropIcon(env,{icon:old.icon!==icon.icon?old.icon:null,apple:old.apple!==icon.apple?old.apple:null});
  return {ok:true,icon};
 }
 if(action)fail(404,'找不到 API');
 const theme=themeInput(b.theme);
 await db.batch([stmt(db,"INSERT INTO settings VALUES('theme',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(theme)),audit(db,admin.email,'appearance.theme','theme',{theme:typeof theme==='string'?theme:'custom'})]);
 return {ok:true,theme,palette:resolvePalette(theme)};
}
// GET /theme.css — the saved palette, or ?preview=1&brand=…&deep=…&action=…&ink=…&accent=… (or &theme=<id>) scoped to .theme-preview.
export async function siteAppearanceCSS(req,env,url){
 let css;
 if(url.searchParams.has('preview')){
  const id=url.searchParams.get('theme'),custom={id:'custom',...Object.fromEntries(paletteKeys.map(k=>[k,url.searchParams.get(k)]))};
  const saved=id&&themes.some(t=>t.id===id)?id:paletteKeys.every(k=>isHex(custom[k]))?custom:themes[0].id;
  // Preview always emits explicit variables so the default palette also overrides whatever the page uses.
  const p=resolvePalette(saved);css=themeCSS(p.id===themes[0].id?{...p,id:'custom'}:saved,'.theme-preview');
 }else{let cfg={};try{cfg=await settings(env.DB);}catch{/* default colors */}css=themeCSS(savedTheme(cfg));}
 const etag='"'+(await hash(css)).slice(0,16)+'"';
 if(req.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'no-cache'}});
 return new Response(css,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-cache',ETag:etag}});
}
export async function siteIcon(env,path){
 let icon;try{icon=(await settings(env.DB)).site_icon;}catch{return null;}
 const id=path==='/apple-touch-icon.png'?icon?.apple:icon?.icon;if(!id)return null;
 const img=await one(env.DB,'SELECT object_key FROM site_images WHERE id=?',id);if(!img)return null;
 const object=await env.PHOTOS.get(img.object_key);if(!object)return null;
 return new Response(object.body,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
}
