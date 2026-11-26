#!/usr/bin/env node
// 產生活動成果報告（Markdown），給 event-report skill 使用。
// 只用 wrangler d1 execute 執行唯讀的統計查詢：人數、出席、身分／年齡／性別分布、課程回饋平均分數。
// 不讀取姓名、Email、電話、簽名、表單答案或回饋的文字內容。
// 用法：
//   node scripts/event-report.mjs --event <活動 id> [--remote|--local] [--persist-to <目錄>]
//   node scripts/event-report.mjs --year 2026      [--remote|--local]
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const root=new URL('..',import.meta.url).pathname;
const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
const die=m=>{console.error('錯誤：'+m);process.exit(1);};
const eventId=opt('--event'),year=opt('--year');
if(!eventId===!year)die('請指定 --event <活動 id> 或 --year <西元年> 其中一個');
if(eventId&&!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(eventId))die('活動 id 格式錯誤');
if(year&&!/^\d{4}$/.test(year))die('年份格式錯誤');
if(!args.includes('--remote')&&!args.includes('--local'))die('請指定 --remote（正式網站）或 --local（本機）');
const target=args.includes('--remote')?['--remote']:['--local',...(opt('--persist-to')?['--persist-to',opt('--persist-to')]:[])];
const run=sql=>{
 const out=execFileSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB',...target,'--json','--command',sql],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const parsed=JSON.parse(out);return parsed[0]?.results??[];
};
const scope=eventId?`e.id='${eventId}'`:`substr(datetime(s.starts_at,'+8 hours'),1,4)='${year}'`;
const base=`FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE e.deleted_at IS NULL AND ${scope}`;

const sessions=run(`SELECT e.id event_id,e.title,s.id session_id,s.starts_at,s.ends_at,s.location,s.fee,s.status,s.capacity,
 (SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status IN('pending','confirmed')) registered,
 (SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status='confirmed') confirmed,
 (SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status='waitlisted') waitlisted,
 (SELECT COUNT(*) FROM registrations r WHERE r.session_id=s.id AND r.status='cancelled') cancelled_regs,
 (SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status IN('pending','confirmed') AND r.registration_source='online' AND r.created_by_admin IS NULL) src_online,
 (SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status IN('pending','confirmed') AND r.created_by_admin IS NOT NULL) src_admin,
 (SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status IN('pending','confirmed') AND r.registration_source='onsite') src_onsite,
 (SELECT COUNT(*) FROM checkins c WHERE c.session_id=s.id) checkins,
 (SELECT COUNT(*) FROM checkin_attendees a JOIN checkins c ON c.registration_id=a.registration_id WHERE c.session_id=s.id) attended
 ${base} ORDER BY s.starts_at`);
if(!sessions.length)die(eventId?'找不到這個活動，或活動沒有場次（已刪除的活動不列入）':`${year} 年沒有任何場次`);
const dist=col=>run(`SELECT COALESCE(NULLIF(d.${col},''),'未填') k,COUNT(*) n FROM checkin_attendees a JOIN checkins c ON c.registration_id=a.registration_id
 LEFT JOIN checkin_attendee_details d ON d.registration_id=a.registration_id AND d.position=a.position
 WHERE c.session_id IN(SELECT s.id ${base}) GROUP BY k ORDER BY n DESC`);
const ages=dist('age_group').map(r=>({...r,k:{大:'大人',小:'小孩'}[r.k]||r.k})),genders=dist('gender'),identities=dist('identity');
const feedback=run(`SELECT e.title,COUNT(r.id) responses,(SELECT COUNT(*) FROM feedback_invitations i WHERE i.form_id=f.id AND i.sent_at IS NOT NULL) invited,
 ROUND(AVG(r.overall_rating),2) overall,ROUND(AVG(r.instructor_rating),2) instructor,ROUND(AVG(r.content_rating),2) content,ROUND(AVG(r.usefulness_rating),2) usefulness,ROUND(AVG(r.venue_rating),2) venue,
 SUM(r.difficulty='easy') d_easy,SUM(r.difficulty='normal') d_normal,SUM(r.difficulty='hard') d_hard,SUM(r.difficulty='very_hard') d_very_hard,
 SUM(r.attend_again='yes') again_yes,SUM(r.attend_again='maybe') again_maybe,SUM(r.attend_again='no') again_no,SUM(r.comment IS NOT NULL AND trim(r.comment)<>'') comments
 FROM feedback_forms f JOIN events e ON e.id=f.event_id LEFT JOIN feedback_responses r ON r.form_id=f.id
 WHERE e.id IN(SELECT e.id ${base}) GROUP BY f.id ORDER BY e.title`);
const photos=run(`SELECT COUNT(*) n FROM event_photos p WHERE p.status='published' AND p.event_id IN(SELECT e.id ${base})`)[0]?.n??0;

const fmt=(v,o)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',...o}).format(new Date(v));
const when=s=>`${fmt(s.starts_at,{year:'numeric',month:'numeric',day:'numeric',weekday:'short'})} ${fmt(s.starts_at,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}–${fmt(s.ends_at,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}`;
const pct=(a,b)=>b>0?`${Math.round(a/b*100)}%`:'—';
const sum=k=>sessions.filter(s=>s.status!=='cancelled').reduce((n,s)=>n+(s[k]||0),0);
const held=sessions.filter(s=>s.status!=='cancelled'),cap=held.reduce((n,s)=>n+s.capacity,0);
const titles=[...new Set(sessions.map(s=>s.title))];
const name=eventId?titles[0]:`${year} 年度活動`;
let md=`# ${name}｜成果報告\n\n`;
md+=`> 產生時間：${fmt(Date.now(),{dateStyle:'medium',timeStyle:'short'})}（台灣時間）。資料來源：活動報名網站資料庫，只含統計數字，不含個人資料。\n\n`;
md+=`## 總覽\n\n| 項目 | 數字 |\n| --- | --- |\n`;
if(!eventId)md+=`| 活動數 | ${titles.length} |\n`;
md+=`| 場次 | ${held.length}${sessions.length>held.length?`（另有 ${sessions.length-held.length} 場取消）`:''} |\n| 總名額 | ${cap||'未設定'} |\n| 報名人次（待確認＋已確認） | ${sum('registered')} |\n| 已確認人次 | ${sum('confirmed')} |\n| 候補人次 | ${sum('waitlisted')} |\n| 實際出席人次 | ${sum('attended')} |\n| 出席率（出席／已確認） | ${pct(sum('attended'),sum('confirmed'))} |\n| 名額使用率（報名／名額） | ${pct(sum('registered'),cap)} |\n| 已公開的活動照片 | ${photos} 張 |\n\n`;
md+=`## 各場次\n\n| ${eventId?'':'活動 | '}時間 | 地點 | 名額 | 報名 | 已確認 | 候補 | 出席 | 出席率 |\n| ${eventId?'':'--- | '}--- | --- | --- | --- | --- | --- | --- | --- |\n`;
for(const s of sessions)md+=`| ${eventId?'':s.title+' | '}${when(s)}${s.status==='cancelled'?'（已取消）':''} | ${s.location} | ${s.capacity||'—'} | ${s.registered} | ${s.confirmed} | ${s.waitlisted} | ${s.attended} | ${pct(s.attended,s.confirmed)} |\n`;
md+=`\n## 報名方式\n\n| 方式 | 人次 |\n| --- | --- |\n| 住戶線上報名 | ${sum('src_online')} |\n| 主辦方代填（電話、紙本） | ${sum('src_admin')} |\n| 現場報名 | ${sum('src_onsite')} |\n\n`;
const table=(title,rows)=>`### ${title}\n\n| 類別 | 人次 | 比例 |\n| --- | --- | --- |\n${rows.map(r=>`| ${r.k} | ${r.n} | ${pct(r.n,rows.reduce((a,b)=>a+b.n,0))} |`).join('\n')||'| （無報到資料） | 0 | — |'}\n\n`;
md+=`## 出席者組成（依現場簽到資料）\n\n`+table('身分',identities)+table('年齡（大人／小孩）',ages)+table('性別',genders);
if(feedback.length){
 md+=`## 課程回饋\n\n滿分 5 分。\n\n`;
 for(const f of feedback){
  md+=`### ${f.title}\n\n回覆 ${f.responses} 份${f.invited?`（寄出邀請 ${f.invited} 份，回覆率 ${pct(f.responses,f.invited)}）`:''}。\n\n`;
  if(!f.responses){md+=`尚無回覆。\n\n`;continue;}
  md+=`| 題目 | 平均 |\n| --- | --- |\n| 整體滿意度 | ${f.overall} |\n| 講師 | ${f.instructor} |\n| 課程內容 | ${f.content} |\n| 實用程度 | ${f.usefulness} |\n| 場地 | ${f.venue} |\n\n`;
  md+=`難易度：太簡單 ${f.d_easy}、適中 ${f.d_normal}、有點困難 ${f.d_hard}、太困難 ${f.d_very_hard}。\n是否願意再參加：願意 ${f.again_yes}、視課程主題而定 ${f.again_maybe}、暫時不考慮 ${f.again_no}。\n文字意見 ${f.comments} 則（內容請到後台「課程回饋」查看；放進報告前先刪去可辨識個人的內容）。\n\n`;
 }
}
md+=`## 說明\n\n- 「人次」依每筆報名的參加人數計算；「出席」為現場簽到的人數。\n- 收到報名不等於名額確認，也不等於實際出席，三個數字分開列出。\n- 身分、年齡、性別來自現場簽到單，未填寫的列為「未填」。人數很少的類別對外公開時請合併，避免辨識出個人。\n`;
const dir=resolve(root,'.local/reports');mkdirSync(dir,{recursive:true});
const file=`.local/reports/${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}-${eventId?eventId.slice(0,8):year}-report.md`;
writeFileSync(resolve(root,file),md);console.log(file);
