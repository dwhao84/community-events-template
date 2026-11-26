import {esc,dateLabel} from './shared.js';

const time=value=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));

export function sessionScheduleLabel(session){
 const start=Date.parse(session.starts_at),end=Date.parse(session.ends_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return '';
 const startDate=dateLabel(session.starts_at),endDate=dateLabel(session.ends_at);
 return `${startDate} ${time(session.starts_at)}–${startDate===endDate?'':endDate+' '}${time(session.ends_at)}${session.status==='cancelled'?'（已取消）':''}`;
}

// The API's session fields are the only source of dates; notes stay free-form.
export function eventNotesMarkup(event){
 const sessions=(event.sessions||[]).filter(session=>['published','cancelled'].includes(session.status)).slice().sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
 const schedules=sessions.map(sessionScheduleLabel).filter(Boolean);
 const schedule=schedules.length?`<p class="event-description"><strong>活動時間</strong><br>${schedules.map(esc).join('<br>')}</p>`:'';
 const notes=event.notes?`<p class="event-description">${esc(event.notes)}</p>`:'';
 return schedule||notes?`<details><summary>活動注意事項</summary>${schedule}${notes}</details>`:'';
}
