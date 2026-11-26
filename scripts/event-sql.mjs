#!/usr/bin/env node
// 產生「新增活動／隱藏活動／取消隱藏」用的 SQL 檔，給 manage-events skill 使用。只寫檔，不連任何資料庫。
// 規則與後台「新增活動精靈」相同：收費（feeInput）、每筆人數上限、標準報名表、提醒時間都沿用 src/ 的函式。
// 用法：
//   node scripts/event-sql.mjs add <spec.json>   新增活動（格式見 .agents/skills/manage-events/SKILL.md）
//   node scripts/event-sql.mjs hide <活動 id>     隱藏：前台看不到，報名與提醒信照常
//   node scripts/event-sql.mjs show <活動 id>     取消隱藏
// 加 --print 只印出 SQL；否則寫到 .local/data-changes/ 並印出檔名。
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {uid,reminderAt,validateFields,text} from '../src/lib.js';
import {feeInput,seatLimitInput,standardFields} from '../src/admin-tools.js';

const root=new URL('..',import.meta.url).pathname;
const q=v=>v===null||v===undefined?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const die=m=>{console.error('錯誤：'+m);process.exit(1);};
const guard=f=>{try{return f();}catch(e){die(e.message);}};
const taipei=(date,time)=>{ // 台灣固定 UTC+8，沒有夏令時間
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))die(`日期格式須為 YYYY-MM-DD：${date}`);
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))die(`時間格式須為 HH:MM：${time}`);
 const d=new Date(`${date}T${time}:00+08:00`);if(isNaN(d))die(`無效日期：${date} ${time}`);return d.toISOString();
};
const auditSQL=(action,target,summary,now)=>`INSERT INTO audit_logs VALUES(${[uid(),'ai-assistant:manage-events',action,target,JSON.stringify(summary),now].map(q).join(',')});\n`;
function imageInfo(file){
 const b=readFileSync(file);
 if(b.slice(1,4).toString()==='PNG')return {mime:'image/png',size:b.length,width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(b[0]===0xff&&b[1]===0xd8){let i=2;while(i+8<b.length){if(b[i]!==0xff){i++;continue;}const m=b[i+1];if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return {mime:'image/jpeg',size:b.length,height:b.readUInt16BE(i+5),width:b.readUInt16BE(i+7)};i+=2+b.readUInt16BE(i+2);}}
 die(`封面請用 PNG 或 JPEG：${file}`);
}

function add(spec){
 const now=new Date().toISOString(),id=spec.id||uid(),formId=uid();
 const title=text(spec.title||'',200).trim();if(!title)die('title（活動名稱）必填');
 const event={description:text(spec.description||'',10000),notes:text(spec.notes||'',3000),contact:text(spec.contact||'',500)};
 const status=spec.status||'published';if(!['published','draft'].includes(status))die('status 只能是 published（公開）或 draft（草稿）');
 if(!Array.isArray(spec.sessions)||!spec.sessions.length)die('至少需要一個場次（sessions）');
 const sessions=spec.sessions.map(s=>{
  const starts_at=taipei(s.date,s.start),ends_at=taipei(s.end_date||s.date,s.end);if(ends_at<=starts_at)die(`場次結束須晚於開始：${s.date} ${s.start}`);
  const capacity=s.capacity??0;if(!Number.isInteger(capacity)||capacity<0||capacity>100000)die('capacity（名額）須為 0–100000 的整數');
  const fee=guard(()=>feeInput(s)),max=guard(()=>seatLimitInput(s.max_seats_per_registration)),location=text(s.location||'待定',300),open=s.registration_open?1:0;
  if(open&&(status!=='published'||capacity<1||location==='待定'||fee.fee_type==='tbd'||!event.contact.trim()))die(`開放報名前須確認：活動公開、名額大於 0、地點、收費方式與主辦方聯絡方式（${s.date}）`);
  const at=v=>v?taipei(...v.split(' ')):null,reminder_time=s.reminder_time||'09:00';
  return {id:uid(),starts_at,ends_at,location,capacity,...fee,max_seats_per_registration:max,supplies:text(s.supplies||'',500),registration_open:open,opens_at:at(s.opens_at),closes_at:at(s.closes_at),reminder_enabled:s.reminder_enabled===false?0:1,reminder_time,reminder_at:guard(()=>reminderAt(starts_at,reminder_time))};
 });
 const fields=guard(()=>Array.isArray(spec.fields)?validateFields(spec.fields):standardFields(Math.max(...sessions.map(s=>s.max_seats_per_registration))));
 const cover=spec.cover?{id:uid(),...spec.cover}:null;
 let sql=`-- 新增活動：${title.replaceAll('\n',' ')}\n-- 活動 id：${id}\n`;
 sql+=`INSERT INTO events(id,title,description,notes,contact,status,default_form_id,cover_photo_id,created_at,updated_at) VALUES(${[id,title,event.description,event.notes,event.contact,status,formId,cover?.id,now,now].map(q).join(',')});\n`;
 sql+=`INSERT INTO form_versions(id,event_id,version,status,fields_json,created_at) VALUES(${[formId,id,1,'published',JSON.stringify(fields),now].map(q).join(',')});\n`;
 for(const s of sessions)sql+=`INSERT INTO event_sessions(id,event_id,starts_at,ends_at,timezone,location,capacity,fee,fee_type,fee_amount,fee_note,max_seats_per_registration,supplies,status,registration_open,opens_at,closes_at,form_id,reminder_enabled,reminder_time,reminder_at,revision,created_at,updated_at) VALUES(${[s.id,id,s.starts_at,s.ends_at,'Asia/Taipei',s.location,s.capacity,s.fee,s.fee_type,s.fee_amount,s.fee_note,s.max_seats_per_registration,s.supplies,'published',s.registration_open,s.opens_at,s.closes_at,null,s.reminder_enabled,s.reminder_time,s.reminder_at,1,now,now].map(q).join(',')});\n`;
 const uploads=[];
 if(cover){
  const file=resolve(root,cover.file||''),thumb=resolve(root,cover.thumbnail||'');
  if(!cover.file||!existsSync(file))die(`找不到封面檔：${cover.file}`);if(!cover.thumbnail||!existsSync(thumb))die(`找不到封面縮圖：${cover.thumbnail}`);
  const info=imageInfo(file),key=`photos/${id}/${cover.id}`;
  sql+=`INSERT INTO event_photos(id,event_id,session_id,object_key,thumbnail_key,mime,size,width,height,caption,sort_order,status,created_at) VALUES(${[cover.id,id,null,key,`${key}/thumbnail`,info.mime,info.size,info.width,info.height,text(cover.caption||`${title}主視覺`,300),0,'published',now].map(q).join(',')});\n`;
  uploads.push({key,file:cover.file,mime:info.mime},{key:`${key}/thumbnail`,file:cover.thumbnail,mime:imageInfo(thumb).mime});
 }
 sql+=auditSQL('event.create',id,{sessions:sessions.length,status,open:sessions.some(s=>s.registration_open)},now);
 return {sql,name:`add-${id.slice(0,8)}`,id,uploads};
}
function setHidden(id,hidden){
 if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(id||''))die('請提供活動 id（可用 SKILL.md 裡的查詢列出）');
 const now=new Date().toISOString();
 const sql=`-- ${hidden?'隱藏':'取消隱藏'}活動 ${id}${hidden?'：前台看不到，報名、提醒信與資料全部保留':''}\nUPDATE events SET hidden=${hidden?1:0},updated_at=${q(now)} WHERE id=${q(id)} AND deleted_at IS NULL AND hidden=${hidden?0:1};\n`
  +`-- 只有真的改到時才寫操作紀錄（重複執行不會多一筆）\nINSERT INTO audit_logs SELECT lower(hex(randomblob(16))),'ai-assistant:manage-events',${q(hidden?'event.hide':'event.unhide')},id,'{}',updated_at FROM events WHERE id=${q(id)} AND hidden=${hidden?1:0} AND updated_at=${q(now)} AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE target=${q(id)} AND created_at=${q(now)});\n`;
 return {sql,name:`${hidden?'hide':'show'}-${id.slice(0,8)}`,id,uploads:[]};
}

const [cmd,arg,...flags]=process.argv.slice(2);
const out=cmd==='add'?add(arg?JSON.parse(readFileSync(resolve(arg),'utf8')):die('請提供 spec.json')):cmd==='hide'?setHidden(arg,true):cmd==='show'?setHidden(arg,false):die('指令：add <spec.json> | hide <活動 id> | show <活動 id>');
if(flags.includes('--print')){process.stdout.write(out.sql);process.exit(0);}
const dir=resolve(root,'.local/data-changes');mkdirSync(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,13);
const file=`.local/data-changes/${stamp}-${out.name}.sql`;writeFileSync(resolve(root,file),out.sql);
console.log(JSON.stringify({file,event_id:out.id,r2_uploads:out.uploads},null,1));
