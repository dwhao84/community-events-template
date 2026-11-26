#!/usr/bin/env node
// 產生「調整場次」用的 SQL 檔，給 update-sessions skill 使用。只寫檔，不連任何資料庫。
// 規則與後台場次編輯相同：收費（feeInput）、人數上限、提醒時間、開放報名條件；每次修改 revision+1，
// 由資料庫觸發器取消舊提醒並依新時間重建，名額低於已保留人數時由觸發器拒絕。
// 用法：
//   node scripts/session-sql.mjs <目前場次.json> <修改內容.json> [--print]
// 目前場次.json：SKILL.md 裡查詢指令的 --json 輸出（直接存檔即可）。
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {reminderAt,text} from '../src/lib.js';
import {feeInput,seatLimitInput} from '../src/admin-tools.js';

const root=new URL('..',import.meta.url).pathname;
const q=v=>v===null||v===undefined?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const die=m=>{console.error('錯誤：'+m);process.exit(1);};
const guard=f=>{try{return f();}catch(e){die(e.message);}};
const taipei=(date,time)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))die(`日期格式須為 YYYY-MM-DD：${date}`);
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))die(`時間格式須為 HH:MM：${time}`);
 const d=new Date(`${date}T${time}:00+08:00`);if(isNaN(d))die(`無效日期：${date} ${time}`);return d.toISOString();
};
const tw=v=>v?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):null; // 2027-01-10 14:00

const [curFile,chgFile,...flags]=process.argv.slice(2);
if(!curFile||!chgFile)die('用法：node scripts/session-sql.mjs <目前場次.json> <修改內容.json> [--print]');
let cur=JSON.parse(readFileSync(resolve(curFile),'utf8'));
if(Array.isArray(cur))cur=cur[0]?.results?cur[0].results:cur; // 接受 wrangler --json 的原始輸出
if(Array.isArray(cur)){if(cur.length!==1)die(`目前場次須剛好一筆，實際 ${cur.length} 筆；請用場次 id 查詢`);cur=cur[0];}
const chg=JSON.parse(readFileSync(resolve(chgFile),'utf8'));
for(const k of ['id','revision','starts_at','ends_at','event_contact','event_status','occupied'])if(cur[k]===undefined)die(`目前場次資料缺少 ${k}，請用 SKILL.md 的查詢指令重新取得`);
if(cur.deleted_at)die('這個活動已刪除，請先在後台復原');
if(cur.status==='cancelled')die('已取消的場次不能用這個方式修改，請在後台處理');
const allowed=['date','start','end','end_date','location','capacity','fee_type','fee_amount','fee_note','max_seats_per_registration','supplies','registration_open','opens_at','closes_at','reminder_time','reminder_enabled','cancel'];
for(const k of Object.keys(chg))if(!allowed.includes(k))die(`不支援的欄位：${k}（可用：${allowed.join('、')}）`);

const now=new Date().toISOString(),s={...cur};
if(chg.date||chg.start||chg.end||chg.end_date){
 const [d0,t0]=tw(cur.starts_at).split(' '),[d1,t1]=tw(cur.ends_at).split(' ');
 s.starts_at=taipei(chg.date||d0,chg.start||t0);s.ends_at=taipei(chg.end_date||chg.date||d1,chg.end||t1);
 if(s.ends_at<=s.starts_at)die('結束時間須晚於開始時間');
}
if(chg.location!==undefined)s.location=text(chg.location||'待定',300);
if(chg.capacity!==undefined){if(!Number.isInteger(chg.capacity)||chg.capacity<0||chg.capacity>100000)die('名額須為 0–100000 的整數');s.capacity=chg.capacity;}
if(s.capacity<cur.occupied)die(`名額不能少於已保留的 ${cur.occupied} 人（待確認＋已確認）。請先在後台處理報名，再調整名額`);
Object.assign(s,guard(()=>feeInput(chg,cur)));
s.max_seats_per_registration=guard(()=>seatLimitInput(chg.max_seats_per_registration,cur.max_seats_per_registration));
if(chg.supplies!==undefined)s.supplies=text(chg.supplies,500);
const at=v=>v===null?null:v===undefined?undefined:taipei(...String(v).split(' '));
if(chg.opens_at!==undefined)s.opens_at=at(chg.opens_at);
if(chg.closes_at!==undefined)s.closes_at=at(chg.closes_at);
if(s.opens_at&&s.closes_at&&s.opens_at>=s.closes_at)die('報名截止須晚於開放時間');
if(chg.reminder_enabled!==undefined)s.reminder_enabled=chg.reminder_enabled?1:0;
if(chg.reminder_time)s.reminder_time=chg.reminder_time;
s.reminder_at=guard(()=>reminderAt(s.starts_at,s.reminder_time||'09:00'));
if(chg.registration_open!==undefined)s.registration_open=chg.registration_open?1:0;
if(chg.cancel===true){s.status='cancelled';s.registration_open=0;}
if(s.registration_open){
 const miss=[cur.event_status!=='published'&&'活動尚未公開',s.capacity<1&&'名額',s.location==='待定'&&'地點',s.fee_type==='tbd'&&'收費方式',!String(cur.event_contact||'').trim()&&'主辦方聯絡方式',!cur.active_form_id&&'報名表',String(cur.operating_ready)!=='true'&&'後台「營運設定」尚未開啟'].filter(Boolean);
 if(miss.length)die(`開放報名前須先確認：${miss.join('、')}`);
 if(Date.parse(s.starts_at)<=Date.now())die('場次已開始或已結束，不能開放報名');
}

const cols=['starts_at','ends_at','location','capacity','fee','fee_type','fee_amount','fee_note','max_seats_per_registration','supplies','status','registration_open','opens_at','closes_at','reminder_enabled','reminder_time','reminder_at'];
const changed=cols.filter(k=>(s[k]??null)!==(cur[k]??null));
if(!changed.length)die('沒有任何變更');
const timePlace=['starts_at','ends_at','location'].some(k=>changed.includes(k));
let sql=`-- 調整場次 ${cur.id}（${cur.title||''}）：${changed.join(', ')}\n`;
sql+=`-- revision 檢查：後台若在這之後改過同一場次，這次更新不會生效（0 筆變更），請重新查詢後再產生\n`;
sql+=`UPDATE event_sessions SET ${changed.map(k=>`${k}=${q(s[k])}`).join(',')},revision=revision+1,updated_at=${q(now)} WHERE id=${q(cur.id)} AND revision=${q(cur.revision)};\n`;
sql+=`-- 只有真的更新時才寫操作紀錄（重複執行不會多一筆）\nINSERT INTO audit_logs SELECT lower(hex(randomblob(16))),'ai-assistant:update-sessions',${q(chg.cancel?'session.cancel':'session.update')},id,${q(JSON.stringify({revision:cur.revision+1,changed}))},updated_at FROM event_sessions WHERE id=${q(cur.id)} AND revision=${q(cur.revision+1)} AND updated_at=${q(now)} AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE target=${q(cur.id)} AND created_at=${q(now)});\n`;
const summary={changed:Object.fromEntries(changed.map(k=>[k,{from:k.endsWith('_at')?tw(cur[k]):cur[k]??null,to:k.endsWith('_at')?tw(s[k]):s[k]??null}])),
 notify:chg.cancel?'場次已取消：請到後台「通知中心」寄「活動取消通知」給已報名者':timePlace&&cur.occupied>0?'時間或地點有變：請到後台「通知中心」寄「活動資訊更新」給已報名者':null,
 waitlist:chg.capacity>cur.capacity&&cur.waitlisted>0?`名額增加了，目前有 ${cur.waitlisted} 筆候補；候補不會自動轉正，請到後台報名名單確認`:null};
if(flags.includes('--print')){process.stdout.write(sql);console.error(JSON.stringify(summary,null,1));process.exit(0);}
mkdirSync(resolve(root,'.local/data-changes'),{recursive:true});
const file=`.local/data-changes/${now.replace(/[-:]/g,'').slice(0,13)}-session-${cur.id.slice(0,8)}.sql`;
writeFileSync(resolve(root,file),sql);console.log(JSON.stringify({file,...summary},null,1));
