import {api,esc} from '../shared.js';
import {siteConfig} from '../site.js';
let identities=['社區住戶','附近居民','其他'];
import {paintSignature} from './signature.js';

import {timeRange} from './signin-format.js';

// Matches the paper form: free sessions tick 免費, a numeric fee ticks 繳費 with the amount, anything else (e.g. 待定) stays blank.
function feeCell(value,p={}){
 const text=String(value||'').trim(),explicit=p.fee_status!==undefined&&p.fee_status!==null,free=explicit?p.fee_status==='free':text==='免費',amount=explicit?(p.fee_status==='paid'?String(p.fee_amount):''):(free?'':(text.match(/\d[\d,]*/)?.[0]||'').replaceAll(',',''));
 return `<span class="choice">${free?'☑':'☐'}免費</span><span class="choice">${amount?'☑':'☐'}繳費 <span class="blank">${esc(amount)}</span> 元</span>`;
}
const person=(n,name,fee,p={})=>`<tbody><tr><td rowspan="2" class="num">${n}</td><td rowspan="2" class="name">${esc(name==='（手寫姓名）'&&p.signature_json?'':name)}${p.signature_json?'<canvas class="printed-signature" width="800" height="280" aria-label="手寫簽名"></canvas>':''}</td><td class="g">${p.age_group==='大'?'☑':''}大</td>${['男','女','其他'].map(v=>`<td class="g">${p.age_group==='大'&&p.gender===v?'☑':''}${v}</td>`).join('')}<td rowspan="2" class="identity">${identities.map(v=>`<span class="choice">${p.identity===v?'☑':'☐'}${esc(v)}</span>`).join('')}</td><td rowspan="2" class="fee">${feeCell(fee,p)}</td></tr><tr><td class="g">${p.age_group==='小'?'☑':''}小</td>${['男','女','其他'].map(v=>`<td class="g">${p.age_group==='小'&&p.gender===v?'☑':''}${v}</td>`).join('')}</tr></tbody>`;

async function start(){
 const c=await siteConfig();if(Array.isArray(c.identities)&&c.identities.length)identities=c.identities;
 const note=document.querySelector('#sheet-note'),sheet=document.querySelector('#sheet'),blank=document.querySelector('#blank-rows');
 const sid=decodeURIComponent(location.hash.slice(1));if(!sid){note.textContent='請從後台「現場報到」頁開啟簽到單。';return;}
 const fromRegistrations=new URLSearchParams(location.search).get('source')==='registrations';
 let data;try{data=await api(`/api/admin/${fromRegistrations?'registrations':'checkins'}/sheet?session_id=${encodeURIComponent(sid)}`);}catch(e){note.textContent=e.status===403?'需要「名單匯出」權限才能列印簽到單。':e.message;return;}
 const {session:s,rows}=data;document.title=`${s.title} 簽到單`;
 // Paper activity codes are separate from the event/session IDs used by registrations.
 const activityCode=`#${s.event_id}`;
 const draw=()=>{
  const extra=Math.max(0,Math.min(50,Math.floor(Number(blank.value)||0)));
  const body=[...rows.map((r,i)=>person(i+1,r.full_name,r.fee_snapshot,r)),...Array.from({length:extra},(_,i)=>person(rows.length+i+1,'',s.fee))].join('');
  sheet.innerHTML=`<h1>${esc(s.title)} – 簽到單 (${esc(activityCode)})</h1><p class="meta">時間：${esc(timeRange(s.starts_at,s.ends_at))}</p><p class="meta">地點：${esc(s.location||'')}</p><table><colgroup><col class="c-num"><col class="c-name"><col class="c-age"><col span="3" class="c-gender"><col class="c-identity"><col class="c-fee"></colgroup><thead><tr><th>序號</th><th>姓名</th><th colspan="4">性別</th><th>身分</th><th>活動收費情形</th></tr></thead>${body}</table>`;
  let canvasIndex=0;for(const r of rows)if(r.signature_json)paintSignature(sheet.querySelectorAll('.printed-signature')[canvasIndex++],JSON.parse(r.signature_json));
  note.textContent=fromRegistrations?(rows.length?`已依 ${data.registrations} 筆報名（待確認＋已確認）帶入 ${rows.length} 位參加者；此為報名名單，不代表實際出席。`:'此場次尚無待確認或已確認的報名，可加入空白列供現場手寫。'):rows.length?`已帶入 ${rows.length} 位已填姓名的到場者。`:'尚無已填姓名的報到紀錄，可加入空白列供現場手寫。';
 };
 blank.oninput=draw;document.querySelector('#print-sheet').onclick=()=>print();draw();
}
start();
