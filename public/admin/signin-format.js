const parts=v=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v)).map(p=>[p.type,p.value]));
const dayText=p=>`${p.year} 年 ${Number(p.month)} 月 ${Number(p.day)} 日`;
export function timeRange(start,end){
 const a=parts(start);let out=`${dayText(a)} ${a.hour} 時 ${a.minute} 分`;if(!end)return out;
 const b=parts(end);return `${out}至${dayText(b)===dayText(a)?'':` ${dayText(b)}`} ${b.hour} 時 ${b.minute} 分`;
}
