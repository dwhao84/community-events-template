// iCalendar (.ics) for one session plus a Google Calendar link. Times are UTC; no participant data is ever included.
const stamp=v=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export const icsEscape=v=>String(v??'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
// RFC 5545 folds lines longer than 75 octets; never split a UTF-8 character.
export function fold(line){
 const enc=new TextEncoder();if(enc.encode(line).length<=75)return line;
 const out=[];let cur='',size=0;
 for(const ch of line){const n=enc.encode(ch).length;if(size+n>(out.length?74:75)){out.push(cur);cur='';size=0;}cur+=ch;size+=n;}
 out.push(cur);return out.join('\r\n ');
}
export function sessionICS(s,{siteUrl='',host='community-events',now=new Date()}={}){
 const url=siteUrl?`${siteUrl}/#event-${s.event_id}`:'';
 const description=[s.fee?`費用：${s.fee}`:'',s.supplies||'',url?`活動資訊：${url}`:''].filter(Boolean).join('\n');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Community Events//Calendar//ZH-TW','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
  `UID:${s.id}@${host}`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(s.starts_at)}`,`DTEND:${stamp(s.ends_at)}`,`SEQUENCE:${Math.max(0,(s.revision||1)-1)}`,
  `SUMMARY:${icsEscape(s.title)}`,...(s.location?[`LOCATION:${icsEscape(s.location)}`]:[]),...(description?[`DESCRIPTION:${icsEscape(description)}`]:[]),...(url?[`URL:${url}`]:[]),
  `STATUS:${s.status==='cancelled'?'CANCELLED':'CONFIRMED'}`,'END:VEVENT','END:VCALENDAR'];
 return lines.map(fold).join('\r\n')+'\r\n';
}
export function googleCalendarURL(s,siteUrl=''){
 const q=new URLSearchParams({action:'TEMPLATE',text:s.title||'',dates:`${stamp(s.starts_at)}/${stamp(s.ends_at)}`,details:[s.fee?`費用：${s.fee}`:'',siteUrl?`活動資訊：${siteUrl}/`:''].filter(Boolean).join('\n'),location:s.location||'',ctz:'Asia/Taipei'});
 return 'https://calendar.google.com/calendar/render?'+q.toString();
}
export const icsURL=(siteUrl,sessionId)=>`${siteUrl}/api/sessions/${encodeURIComponent(sessionId)}/calendar.ics`;
