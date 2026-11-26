import {site} from './site.js';
import {emailLayout} from './email-layout.js';
import {fail,one,run,nowISO,hash,csvCell,emailValid,dateLabel} from './lib.js';

// Fixed V1 template (template_version 1). Answer keys equal the feedback_responses columns.
export const feedbackKinds=['feedback_invite','feedback_reminder','feedback_test'];
export const ratingKeys=['overall_rating','instructor_rating','content_rating','usefulness_rating','venue_rating'];
export const ratingLabels=['非常不滿意','不滿意','普通','滿意','非常滿意'];
export const difficultyOptions=[['easy','太簡單'],['normal','適中'],['hard','有點困難'],['very_hard','太困難']];
export const attendOptions=[['yes','願意'],['maybe','視課程主題而定'],['no','暫時不考慮']];
export const commentMax=2000;
export const questions=[
 {id:'overall_rating',no:'Q1',type:'rating',required:true,label:'您對本次課程的整體滿意度？',short:'整體滿意度'},
 {id:'instructor_rating',no:'Q2',type:'rating',required:true,label:'您對講師的教學與說明方式是否滿意？',short:'講師教學'},
 {id:'content_rating',no:'Q3',type:'rating',required:true,label:'您對課程內容的易懂程度是否滿意？',short:'內容易懂'},
 {id:'usefulness_rating',no:'Q4',type:'rating',required:true,label:'您對課程內容的實用性是否滿意？',short:'內容實用'},
 {id:'venue_rating',no:'Q5',type:'rating',required:true,label:'您對課程場地及設備是否滿意？',short:'場地設備'},
 {id:'difficulty',no:'Q6',type:'choice',required:true,label:'您認為本次課程的難易度？',short:'難易度',options:difficultyOptions},
 {id:'attend_again',no:'Q7',type:'choice',required:true,label:'未來是否願意再次參加我們舉辦的課程？',short:'再次參加意願',options:attendOptions},
 {id:'comment',no:'Q8',type:'text',required:false,label:'其他建議或希望未來開設的課程？',short:'其他建議',maxLength:commentMax,help:'選填，最多 2,000 字。請勿填寫姓名、電話、身分證字號等個人敏感資訊。'}
];
const optionLabel=(options,v)=>(options.find(([k])=>k===v)||[])[1]||'';
export const difficultyLabel=v=>optionLabel(difficultyOptions,v);
export const attendLabel=v=>optionLabel(attendOptions,v);

export function validateFeedback(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'答案格式錯誤');
 const out={},errors={};
 for(const k of ratingKeys){const v=raw[k];if(!Number.isInteger(v)||v<1||v>5)errors[k]='請選擇 1–5 分';else out[k]=v;}
 for(const [k,options] of [['difficulty',difficultyOptions],['attend_again',attendOptions]]){if(!options.some(([o])=>o===raw[k]))errors[k]='請選擇一個選項';else out[k]=raw[k];}
 const c=raw.comment??'';
 if(typeof c!=='string')errors.comment='文字格式錯誤';else{const t=c.trim();if([...t].length>commentMax)errors.comment=`最多 ${commentMax.toLocaleString('en-US')} 字`;else out.comment=t||null;}
 if(Object.keys(errors).length)fail(400,'請完成必填題目',errors);
 return out;
}

// Tokens: HMAC(secret, invitation id + nonce) so the plaintext never needs to be stored; the DB keeps SHA-256 only.
export const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const randomToken=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
export const randomNonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
export const tokenHash=token=>hash('feedback-token:'+token);
export function tokenSecret(env){
 const s=env.FEEDBACK_TOKEN_SECRET||(env.APP_ENV==='development'?'development-only-feedback-token-secret-change-me':'');
 if(s.length<32)fail(503,'課程回饋邀請尚未設定（FEEDBACK_TOKEN_SECRET）');return s;
}
export async function inviteToken(secret,inv){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`feedback-invite:v1:${inv.id}:${inv.token_nonce}`))));
}
export function siteURL(env){
 const u=String(env.SITE_URL||'').replace(/\/$/,'');
 if(!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u)||(env.APP_ENV!=='development'&&!u.startsWith('https://')))fail(503,'尚未設定網站網址（SITE_URL）');return u;
}
export const feedbackURL=(site,slug,token)=>`${site}/feedback/${encodeURIComponent(slug)}?token=${token}`;

// FR-05 wording. Plain text keeps every line; HTML shows the course rows and a button instead of repeating them.
export function feedbackMessage(kind,data,{replyTo,test=false}={}){
 const reminder=kind==='reminder',name=String(data.event_name??'').replace(/[\r\n]+/g,' ');
 const subject=`${test?'【測試】':''}【${site.communityName}】課程回饋${reminder?'提醒':'邀請'}｜${name}`;
 const intro=reminder?`這是「${name}」課程回饋的提醒。若您有參與本次課程且尚未填寫，誠摯邀請您撥空分享學習心得與建議；若您未出席本次課程或已完成填寫，請忽略本信。`:`感謝您報名本次${site.communityName}的「${name}」課程。若您有參與本次課程，誠摯邀請您撥空分享學習心得與建議，協助我們改善未來課程品質。`;
 const note='填寫時間約為 1～2 分鐘。此為您的專屬填寫連結，請勿轉傳。回饋內容僅供課程規劃及品質改善使用。';
 const thanks='感謝您的支持，期待未來與您再次一起學習！',sign=site.feedbackOrganizer;
 const text=['您好：',intro,`課程名稱：${name}\n課程日期：${data.event_date}\n課程地點：${data.event_location}`,`填寫課程回饋表：\n${data.feedback_url}`,note,thanks,sign].join('\n\n');
 const html=emailLayout({subject,text:['您好：',intro,note,thanks].join('\n\n'),data:{event_name:name,date:data.event_date,location:data.event_location},kind:test?'feedback_test':reminder?'feedback_reminder':'feedback_invite',replyTo,action:{label:'填寫課程回饋表 →',url:data.feedback_url},signoff:sign});
 return {subject,text,html};
}

// Mail-queue integration: payload is rendered at send time so the token plaintext is never written to D1.
const invitationQuery=`SELECT i.*,f.slug,f.status form_status,r.email,r.status registration_status,s.starts_at,s.location,e.title FROM feedback_invitations i JOIN feedback_forms f ON f.id=i.form_id JOIN registrations r ON r.id=i.registration_id JOIN event_sessions s ON s.id=r.session_id JOIN events e ON e.id=s.event_id WHERE i.registration_id=?`;
export async function feedbackPayload(db,job,env,{preview=false}={}){
 if(!job.registration_id)return null;
 const row=await one(db,invitationQuery,job.registration_id);if(!row)return null;
 let url;
 if(preview)url=feedbackURL(String(env.SITE_URL||'').replace(/\/$/,''),row.slug,'（收件者專屬連結，預覽不顯示）');
 else{
  const token=await inviteToken(tokenSecret(env),row),h=await tokenHash(token);
  // Secret rotation: re-key an unused invitation so the link in this mail works; the previous link stops working.
  if(h!==row.token_hash){if(row.used_at)return null;await run(db,'UPDATE feedback_invitations SET token_hash=?,updated_at=? WHERE id=? AND used_at IS NULL',h,nowISO(),row.id);}
  url=feedbackURL(siteURL(env),row.slug,token);
 }
 // No CC: each mail carries a personal one-time link.
 return {from:env.MAIL_FROM,to:[row.email],...(env.MAIL_REPLY_TO?{reply_to:env.MAIL_REPLY_TO}:{}),...feedbackMessage(job.kind==='feedback_reminder'?'reminder':'invite',{event_name:row.title,event_date:dateLabel(row.starts_at),event_location:row.location,feedback_url:url},{replyTo:env.MAIL_REPLY_TO})};
}
export async function feedbackJobEligible(db,job,now){
 if(job.kind==='feedback_test')return true;
 if(!job.registration_id)return false;
 const r=await one(db,invitationQuery,job.registration_id);
 return !!r&&!r.used_at&&r.expires_at>now&&r.form_status==='published'&&['pending','confirmed'].includes(r.registration_status)&&emailValid(r.email);
}

// Recipient rules (FR-04). Returns null when the registration may receive this mode's mail.
export const recipientModes={registered:'所有有效報名者',attended:'已簽到學員',reminder:'提醒尚未填寫者'};
export function exclusionReason(r,mode){
 if(r.status==='cancelled')return '已取消報名';
 if(r.status==='waitlisted')return '候補（未取得名額）';
 if(!emailValid(r.normalized_email||''))return '無有效 Email';
 if(r.used_at)return '已完成填寫';
 if(['pending','processing'].includes(r.last_status))return '寄送處理中';
 if(mode==='reminder')return r.sent_at?null:'尚未成功寄出邀請';
 if(r.sent_at)return '已寄出邀請（可改用提醒）';
 if(r.last_status==='unknown')return '寄送結果不明，請先向寄信服務核對';
 if(['failed','bounced'].includes(r.last_status))return '先前寄送失敗（請用重試）';
 if(mode==='attended'&&!r.checked_in_at)return '未簽到';
 return null;
}

// KPI definitions follow spec §FR-07; null means "no denominator / no valid rating" and displays as —.
export const formatAverage=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(Math.round(v*10)/10).toFixed(1);
export const formatRate=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(Math.round(v*10)/10).toFixed(1)+'%';
export function feedbackStats({registrations=0,attended=0,invitations=[],responses=[]}){
 const sent=invitations.filter(i=>i.sent_at),completed=invitations.filter(i=>i.used_at);
 const failed=invitations.filter(i=>!i.sent_at&&['failed','bounced'].includes(i.last_status)).length;
 const sentCompleted=sent.filter(i=>i.used_at).length,rate=sent.length?sentCompleted/sent.length*100:null;
 const averages={},distribution={};
 for(const k of ratingKeys){const valid=responses.map(r=>r[k]).filter(v=>Number.isInteger(v)&&v>=1&&v<=5);averages[k]=valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;distribution[k]=[1,2,3,4,5].map(n=>valid.filter(v=>v===n).length);}
 for(const [k,options] of [['difficulty',difficultyOptions],['attend_again',attendOptions]])distribution[k]=options.map(([o,label])=>({value:o,label,count:responses.filter(r=>r[k]===o).length}));
 const kpi={registrations,attended,sent:sent.length,failed,completed:completed.length,not_completed:sent.filter(i=>!i.used_at).length,response_rate:rate};
 return {kpi,averages,distribution,responses:responses.length,display:{response_rate:formatRate(rate),...Object.fromEntries(ratingKeys.map(k=>[k,formatAverage(averages[k])]))}};
}

const taipei=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
export const taipeiTime=v=>taipei.format(new Date(v));
// No name, email, invitation id or token columns exist to export; csvCell neutralises formula prefixes.
export function feedbackCSV(event,responses){
 const head=['活動編號','課程名稱','回覆 ID','提交時間（台灣）',...questions.map(q=>`${q.no} ${q.short}`)];
 const rows=responses.map(r=>[event.id,event.title,r.id,taipeiTime(r.submitted_at),...ratingKeys.map(k=>r[k]),difficultyLabel(r.difficulty),attendLabel(r.attend_again),r.comment||'']);
 return '﻿'+[head,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
