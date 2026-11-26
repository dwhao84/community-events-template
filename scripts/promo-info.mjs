#!/usr/bin/env node
// 讀網站的公開活動資料，整理成寫宣傳文案用的事實清單（時間已換成台灣時間，並附活動、報名與行事曆連結）。
// 只讀 /api/public，不需要後台權限，也不含任何報名者資料。給 event-promo skill 使用。
// 用法：node scripts/promo-info.mjs <網站網址> [活動 id 或名稱關鍵字]
const [base,filter]=process.argv.slice(2);
if(!/^https?:\/\//.test(base||'')){console.error('用法：node scripts/promo-info.mjs <網站網址，例如 https://events.example.org> [活動 id 或名稱關鍵字]');process.exit(1);}
const site=base.replace(/\/$/,'');
const res=await fetch(site+'/api/public');if(!res.ok){console.error(`讀取 ${site}/api/public 失敗：HTTP ${res.status}`);process.exit(1);}
const data=await res.json();
const fmt=(v,o)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',...o}).format(new Date(v));
const day=v=>fmt(v,{year:'numeric',month:'numeric',day:'numeric',weekday:'short'});
const hm=v=>fmt(v,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const stamp=v=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const google=(s,title)=>'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:title,dates:`${stamp(s.starts_at)}/${stamp(s.ends_at)}`,details:[s.fee?`費用：${s.fee}`:'',`活動資訊：${site}/`].filter(Boolean).join('\n'),location:s.location||'',ctz:'Asia/Taipei'});
const now=Date.now();
const events=data.events.filter(e=>!filter||e.id===filter||e.title.includes(filter));
if(!events.length){console.error(filter?`公開網站上找不到「${filter}」。活動可能是草稿、已隱藏或已刪除。`:'公開網站上目前沒有活動。');process.exit(2);}
const out={brand:data.brand,site,events:events.map(e=>({
 id:e.id,title:e.title,description:e.description,notes:e.notes,contact:e.contact,
 event_url:`${site}/#event-${e.id}`,
 cover_image:e.cover_photo_id?`${site}/media/${e.cover_photo_id}`:null,
 sessions:e.sessions.map(s=>{
  const ended=Date.parse(s.ends_at)<now,full=s.capacity>0&&s.occupied>=s.capacity;
  const state=s.status==='cancelled'?'已取消':ended?'已結束':!s.registration_open?'尚未開放報名（預告）':s.closes_at&&Date.parse(s.closes_at)<now?'報名已截止':s.opens_at&&Date.parse(s.opens_at)>now?`${day(s.opens_at)} ${hm(s.opens_at)} 開放報名`:full?'已額滿，可登記候補':'開放報名中';
  return {id:s.id,date:day(s.starts_at),time:`${hm(s.starts_at)}–${hm(s.ends_at)}`,ends_on_other_day:day(s.starts_at)!==day(s.ends_at)?day(s.ends_at):undefined,
   location:s.location,fee:s.fee,capacity:s.capacity||null,max_per_registration:s.max_seats_per_registration,supplies:s.supplies||null,
   registration:state,closes_at:s.closes_at?`${day(s.closes_at)} ${hm(s.closes_at)}`:null,
   calendar_ics:s.status==='cancelled'||ended?null:`${site}/api/sessions/${encodeURIComponent(s.id)}/calendar.ics`,
   calendar_google:s.status==='cancelled'||ended?null:google(s,e.title)};
 })
}))};
console.log(JSON.stringify(out,null,1));
