import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {adminAPI} from '../src/api.js';
import {feedbackPublic} from '../src/feedback.js';
import {payloadFor,processJobs} from '../src/mail.js';
import {validateFeedback,feedbackStats,feedbackCSV,formatAverage,formatRate,inviteToken,tokenSecret,tokenHash,exclusionReason} from '../src/feedback-core.js';

const migrations=new URL('../migrations/',import.meta.url);
const files=[...readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort(),'../tests/fixtures/sample-event.sql'];
const apply=(sqlite,names)=>{for(const name of names)sqlite.exec(readFileSync(new URL(name,migrations),'utf8'));};
const reg=(id,session,status,email=`${id}@example.com`)=>`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,status,seats,answers_json,consent_at,consent_version,consent_json,submission_id,created_at,updated_at) VALUES('${id}','${session}','DN-${id.toUpperCase().padStart(8,'0')}','學員${id}','${email}','${email}','anti-fraud-v1','${status}',1,'{}','2026-10-04T01:00:00.000Z','v1','{}','sub-${id}','2026-10-04T01:00:00.000Z','2026-10-04T01:00:00.000Z');`;

// In-memory SQLite with every migration plus the small D1 surface the API uses (same shim as checkin tests).
function env(){
 const sqlite=new DatabaseSync(':memory:');apply(sqlite,files);
 sqlite.exec(`
  UPDATE events SET status='published',contact='organizer@example.com' WHERE id='anti-fraud';
  UPDATE event_sessions SET status='published',capacity=50,location='社區活動中心',fee='免費',registration_open=1,opens_at=NULL,closes_at=NULL WHERE id='anti-fraud-20261017';
  INSERT INTO event_sessions(id,event_id,starts_at,ends_at,location,capacity,fee,status,registration_open,reminder_at,created_at,updated_at) VALUES('anti-fraud-extra','anti-fraud','2026-10-18T05:30:00.000Z','2026-10-18T07:00:00.000Z','<b>二樓</b>教室',50,'免費','published',1,'2026-10-17T01:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
  ${reg('r1','anti-fraud-20261017','confirmed')}
  ${reg('r2','anti-fraud-20261017','pending')}
  ${reg('r3','anti-fraud-20261017','waitlisted')}
  ${reg('r4','anti-fraud-20261017','cancelled')}
  ${reg('r5','anti-fraud-extra','confirmed','r1@example.com')}
  INSERT INTO checkins VALUES('r1','anti-fraud-20261017','免費','2026-10-17T05:40:00.000Z','staff@example.com');
 `);
 const prepare=sql=>({args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){const r=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}});
 return {sqlite,APP_ENV:'development',MAIL_MODE:'mock',SITE_URL:'http://localhost:8787',MAIL_FROM:'team@example.com',DB:{prepare,async batch(list){sqlite.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
const all=['feedback','export'];
function call(e,method,path,body={},permissions=all){
 const url=new URL('https://neighbors.test/api/admin/'+path);
 return adminAPI({method,headers:new Headers()},e,{email:'staff@example.com',permissions},url,url.pathname.split('/').filter(Boolean).slice(2),body);
}
const pub=(e,slug,token,action,body={})=>feedbackPublic({method:action?'POST':'GET',headers:new Headers({'x-feedback-token':token})},e,slug,action,body);
const rejects=(promise,status)=>assert.rejects(promise,err=>err.status===status);
const answers={overall_rating:5,instructor_rating:4,content_rating:4,usefulness_rating:5,venue_rating:3,difficulty:'normal',attend_again:'yes',comment:'希望多開手機課'};
const sid=()=>crypto.randomUUID();
async function opened(e){const {id}=await call(e,'POST','feedback',{event_id:'anti-fraud'});await call(e,'POST',`feedback/${id}/publish`);return id;}
async function send(e,id,mode='registered'){const p=await call(e,'POST',`feedback/${id}/email/preview`,{mode});return call(e,'POST',`feedback/${id}/email/${mode==='reminder'?'remind':'send'}`,{mode,confirm:true,operation_id:sid(),expected_count:p.count});}
async function tokenFor(e,registration){const inv=e.sqlite.prepare('SELECT * FROM feedback_invitations WHERE registration_id=?').get(registration);return inviteToken(tokenSecret(e),inv);}
const slugOf=(e,id)=>e.sqlite.prepare('SELECT slug FROM feedback_forms WHERE id=?').get(id).slug;
const count=(e,sql)=>e.sqlite.prepare(sql).get().n;

test('每個活動僅一份回饋表；狀態依草稿→收集中→關閉→重新開放，並由觸發器擋下非法轉換',async()=>{
 const e=env(),{id}=await call(e,'POST','feedback',{event_id:'anti-fraud'});
 await rejects(call(e,'POST','feedback',{event_id:'anti-fraud'}),409);
 const d=await call(e,'GET',`feedback/${id}`);
 assert.equal(d.form.status,'draft');assert.equal(d.course.title,'範例測試活動');assert.equal(d.course.counts.valid,3);assert.equal(d.course.counts.attended,1);assert.equal(d.questions.length,8);
 await rejects(call(e,'POST',`feedback/${id}/close`),409);
 await call(e,'POST',`feedback/${id}/publish`);await rejects(call(e,'POST',`feedback/${id}/publish`),409);
 await call(e,'POST',`feedback/${id}/close`);await call(e,'POST',`feedback/${id}/publish`);
 assert.equal(e.sqlite.prepare('SELECT status FROM feedback_forms WHERE id=?').get(id).status,'published');
 assert.throws(()=>e.sqlite.exec(`UPDATE feedback_forms SET status='draft' WHERE id='${id}'`),/feedback_status_invalid/);
 await call(e,'PATCH',`feedback/${id}`,{title:'新標題',description:'說明'});assert.equal((await call(e,'GET',`feedback/${id}`)).form.title,'新標題');
 await rejects(call(e,'GET','feedback',{},['registrations']),403);
 await rejects(call(e,'GET',`feedback/${id}/export`,{},['feedback']),403);
});

test('收件預覽排除取消與候補並列出原因；草稿不可正式寄送；名單變動或未確認不寄送',async()=>{
 const e=env(),{id}=await call(e,'POST','feedback',{event_id:'anti-fraud'});
 const p=await call(e,'POST',`feedback/${id}/email/preview`,{mode:'registered'});
 assert.equal(p.count,3);assert.equal(p.can_send,false);
 assert.deepEqual(Object.fromEntries(p.excluded_summary.map(x=>[x.reason,x.count])),{'候補（未取得名額）':1,'已取消報名':1});
 assert.deepEqual(p.duplicates,[{email:'r1@example.com',count:2}],'同一 Email 不同場次的報名須列出，不合併');
 assert.match(p.message.subject,/【○○社區】課程回饋邀請｜範例測試活動/);assert.doesNotMatch(p.message.text,/token=[A-Za-z0-9_-]{43}/);
 const attended=await call(e,'POST',`feedback/${id}/email/preview`,{mode:'attended'});assert.equal(attended.count,1);assert.equal(attended.excluded_summary.find(x=>x.reason==='未簽到').count,2);
 await rejects(call(e,'POST',`feedback/${id}/email/send`,{mode:'registered',confirm:true,operation_id:sid(),expected_count:3}),409);
 await call(e,'POST',`feedback/${id}/publish`);
 await rejects(call(e,'POST',`feedback/${id}/email/send`,{mode:'registered',confirm:false,operation_id:sid(),expected_count:3}),400);
 await rejects(call(e,'POST',`feedback/${id}/email/send`,{mode:'registered',confirm:true,operation_id:sid(),expected_count:2}),409);
 assert.equal(count(e,"SELECT COUNT(*) n FROM email_jobs WHERE kind LIKE 'feedback%'"),0);
});

test('正式寄送每筆報名一份邀請、重複操作不重複寄；Token 只存雜湊，信件內容安全跳脫',async()=>{
 const e=env();e.sqlite.exec("UPDATE events SET title='<script>x</script>防詐' WHERE id='anti-fraud'");
 const id=await opened(e),op=sid(),p=await call(e,'POST',`feedback/${id}/email/preview`,{mode:'registered'});
 const first=await call(e,'POST',`feedback/${id}/email/send`,{mode:'registered',confirm:true,operation_id:op,expected_count:p.count});
 assert.equal(first.queued,3);
 assert.equal((await call(e,'POST',`feedback/${id}/email/send`,{mode:'registered',confirm:true,operation_id:op,expected_count:p.count})).repeated,true);
 await rejects(call(e,'POST',`feedback/${id}/email/send`,{mode:'registered',confirm:true,operation_id:sid(),expected_count:3}),409);
 assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_invitations'),3);
 assert.equal(count(e,"SELECT COUNT(*) n FROM email_jobs WHERE kind='feedback_invite'"),3);
 assert.equal(count(e,"SELECT COUNT(*) n FROM email_jobs WHERE kind='feedback_invite' AND status='accepted' AND payload_json IS NULL"),3,'含 Token 的內容不寫入佇列');
 assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_invitations WHERE sent_at IS NOT NULL'),3);
 // A direct duplicate insert is skipped by the DB guard, not only by the API.
 e.sqlite.exec("INSERT INTO email_jobs(id,registration_id,kind,unique_key,due_at,created_at,updated_at) VALUES('dup','r1','feedback_invite','dup','2030-01-01','2030-01-01','2030-01-01')");
 assert.equal(count(e,"SELECT COUNT(*) n FROM email_jobs WHERE id='dup'"),0);
 const token=await tokenFor(e,'r1');
 assert.equal(count(e,`SELECT COUNT(*) n FROM feedback_invitations WHERE token_hash='${token}'`),0);
 assert.equal(e.sqlite.prepare("SELECT token_hash FROM feedback_invitations WHERE registration_id='r1'").get().token_hash,await tokenHash(token));
 const job=e.sqlite.prepare("SELECT * FROM email_jobs WHERE registration_id='r1' AND kind='feedback_invite'").get();
 const payload=await payloadFor(e.DB,job,e);
 assert.deepEqual(payload.to,['r1@example.com']);assert.equal(payload.cc,undefined);
 assert.ok(payload.text.includes(`http://localhost:8787/feedback/${slugOf(e,id)}?token=${token}`));
 assert.match(payload.text,/填寫時間約為 1～2 分鐘。此為您的專屬填寫連結，請勿轉傳。/);
 assert.doesNotMatch(payload.html,/<script>x/);assert.match(payload.html,/&lt;script&gt;/);
 const preview=await payloadFor(e.DB,job,e,{preview:true});assert.ok(!preview.text.includes(token),'後台預覽不顯示個人連結');
});

test('GET 不消耗 Token；提交原子寫入並標記已使用；重試回傳原結果；回覆不含報名身分',async()=>{
 const e=env(),id=await opened(e);await send(e,id);const slug=slugOf(e,id),token=await tokenFor(e,'r1');
 for(let i=0;i<2;i++){const g=await pub(e,slug,token);assert.equal(g.state,'open');assert.equal(g.preview,false);assert.equal(g.course.location,'社區活動中心');assert.equal(JSON.stringify(g).includes('r1@example.com'),false);}
 await rejects(pub(e,slug,'x'.repeat(43)),404);await rejects(pub(e,slug,'short'),401);await rejects(pub(e,'c-other',token),404);
 await rejects(pub(e,slug,token,'submit',{submission_id:sid(),answers:{...answers,overall_rating:6}}),400);
 await assert.rejects(pub(e,slug,token,'submit',{submission_id:sid(),answers:{comment:'只填建議'}}),err=>err.status===400&&Object.keys(err.details).length===7);
 assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_invitations WHERE used_at IS NOT NULL'),0,'驗證失敗不消耗');
 const submission=sid();
 assert.equal((await pub(e,slug,token,'submit',{submission_id:submission,answers})).ok,true);
 assert.equal((await pub(e,slug,token,'submit',{submission_id:submission,answers})).ok,true,'同一次提交重試取得原結果');
 await rejects(pub(e,slug,token,'submit',{submission_id:sid(),answers}),409);
 assert.equal((await pub(e,slug,token)).state,'used');
 assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_responses'),1);
 const columns=e.sqlite.prepare('PRAGMA table_info(feedback_responses)').all().map(c=>c.name);
 for(const c of ['registration_id','email','token','token_hash','invitation_id'])assert.equal(columns.includes(c),false);
 assert.throws(()=>e.sqlite.exec("UPDATE feedback_invitations SET used_at=NULL WHERE registration_id='r1'"),/feedback_token_used/);
});

test('並行提交同一邀請最多成功一次',async()=>{
 const e=env(),id=await opened(e);await send(e,id);const slug=slugOf(e,id),token=await tokenFor(e,'r2');
 const results=await Promise.allSettled(Array.from({length:5},()=>pub(e,slug,token,'submit',{submission_id:sid(),answers})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===409));
 assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_responses'),1);
});

test('關閉、過期或草稿表單拒絕提交；重新開放後保留既有回覆與已使用狀態',async()=>{
 const e=env(),id=await opened(e);await send(e,id);const slug=slugOf(e,id),t1=await tokenFor(e,'r1'),t2=await tokenFor(e,'r2');
 await pub(e,slug,t1,'submit',{submission_id:sid(),answers});
 await call(e,'POST',`feedback/${id}/close`);
 assert.equal((await pub(e,slug,t2)).state,'closed');
 await assert.rejects(pub(e,slug,t2,'submit',{submission_id:sid(),answers}),err=>err.status===409&&err.details.state==='closed');
 assert.throws(()=>e.sqlite.exec(`INSERT INTO feedback_responses VALUES('x','${id}',5,5,5,5,5,'easy','yes',NULL,'2030-01-01')`),/feedback_form_closed/);
 await call(e,'POST',`feedback/${id}/publish`);
 assert.equal((await pub(e,slug,t1)).state,'used');assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_responses'),1);
 e.sqlite.exec("UPDATE feedback_invitations SET expires_at='2020-01-01T00:00:00.000Z' WHERE registration_id='r2'");
 await assert.rejects(pub(e,slug,t2,'submit',{submission_id:sid(),answers}),err=>err.status===410&&err.details.state==='expired');
});

test('測試信與預覽連結不建立邀請、不儲存回覆、不計入統計',async()=>{
 const e=env(),{id}=await call(e,'POST','feedback',{event_id:'anti-fraud'}),slug=slugOf(e,id);
 const t=await call(e,'POST',`feedback/${id}/email/test`,{email:'Staff@Example.com'});assert.equal(t.status,'accepted');
 const job=e.sqlite.prepare("SELECT * FROM email_jobs WHERE kind='feedback_test'").get(),payload=JSON.parse(job.payload_json);
 assert.deepEqual(payload.to,['staff@example.com']);assert.match(payload.subject,/^【測試】/);assert.match(payload.html,/送出不會儲存回覆/);
 const token=payload.text.match(/token=([A-Za-z0-9_-]{43})/)[1];
 const g=await pub(e,slug,token);assert.equal(g.preview,true);assert.equal(g.state,'open','草稿也可預覽');
 assert.equal((await pub(e,slug,token,'submit',{submission_id:sid(),answers})).preview,true);
 const link=await call(e,'POST',`feedback/${id}/preview`);assert.match(link.url,new RegExp(`^/feedback/${slug}\\?token=`));
 assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_responses'),0);assert.equal(count(e,'SELECT COUNT(*) n FROM feedback_invitations'),0);
 const r=await call(e,'GET',`feedback/${id}/results`);assert.equal(r.kpi.sent,0);assert.equal(r.display.response_rate,'—');assert.equal(r.display.overall_rating,'—');
});

test('提醒只寄給已寄出且未完成者；失敗寄送可安全重試；補寄不增加已寄送人數',async()=>{
 const e=env(),id=await opened(e);await send(e,id);const slug=slugOf(e,id);
 await pub(e,slug,await tokenFor(e,'r1'),'submit',{submission_id:sid(),answers});
 const p=await call(e,'POST',`feedback/${id}/email/preview`,{mode:'reminder'});
 assert.deepEqual(p.recipients.map(r=>r.registration_id).sort(),['r2','r5']);assert.equal(p.excluded_summary.find(x=>x.reason==='已完成填寫').count,1);assert.match(p.message.subject,/課程回饋提醒/);
 assert.equal((await send(e,id,'reminder')).queued,2);
 assert.equal((await call(e,'GET',`feedback/${id}/results`)).kpi.sent,3);
 // Simulate a provider rejection on a new registration, then retry it once.
 e.sqlite.exec(reg('r6','anti-fraud-20261017','confirmed'));
 const e2={...e,MAIL_MODE:'disabled'};await send(e2,id);
 e.sqlite.exec("UPDATE email_jobs SET status='failed',last_error='provider_rejected_422' WHERE registration_id='r6'");
 const pre=await call(e,'POST',`feedback/${id}/email/preview`,{mode:'registered'});assert.deepEqual(pre.retryable.map(r=>r.registration_id),['r6']);assert.equal(pre.excluded.find(r=>r.registration_id==='r6').reason,'先前寄送失敗（請用重試）');
 const before=await call(e,'GET',`feedback/${id}/results`);assert.equal(before.kpi.failed,1);
 assert.equal((await call(e,'POST',`feedback/${id}/email/retry`,{confirm:true,operation_id:sid()})).queued,1);
 const after=await call(e,'GET',`feedback/${id}/results`);assert.equal(after.kpi.failed,0);assert.equal(after.kpi.sent,4);
 await rejects(call(e,'POST',`feedback/${id}/email/retry`,{confirm:true,operation_id:sid()}),409);
});

test('統計：零分母顯示「—」、平均保留一位小數、回覆率以成功寄送為分母',()=>{
 assert.equal(formatAverage(null),'—');assert.equal(formatRate(null),'—');assert.equal(formatAverage(4),'4.0');assert.equal(formatAverage(13/3),'4.3');assert.equal(formatAverage(4.25),'4.3');
 const empty=feedbackStats({});assert.equal(empty.display.response_rate,'—');assert.equal(empty.display.overall_rating,'—');assert.equal(empty.kpi.sent,0);
 const s=feedbackStats({registrations:5,attended:3,invitations:[{sent_at:'t',used_at:'t'},{sent_at:'t',used_at:null},{sent_at:'t',used_at:null},{sent_at:null,used_at:null,last_status:'failed'},{sent_at:null,used_at:null,last_status:'pending'}],responses:[{...answers,overall_rating:4},{...answers,overall_rating:5},{...answers,overall_rating:4,difficulty:'hard'}]});
 assert.deepEqual({...s.kpi,response_rate:Math.round(s.kpi.response_rate*1000)},{registrations:5,attended:3,sent:3,failed:1,completed:1,not_completed:2,response_rate:33333});
 assert.equal(s.display.response_rate,'33.3%');assert.equal(s.display.overall_rating,'4.3');assert.deepEqual(s.distribution.overall_rating,[0,0,0,2,1]);
 assert.equal(s.distribution.difficulty.find(x=>x.value==='hard').count,1);
 assert.equal(exclusionReason({status:'confirmed',normalized_email:'bad'},'registered'),'無有效 Email');
});

test('CSV 匯出 UTF-8、防公式注入且不含個資欄位',()=>{
 const csv=feedbackCSV({id:'anti-fraud',title:'=HYPERLINK("x")'},[{id:'resp-1',submitted_at:'2026-11-24T06:30:00.000Z',...answers,comment:'+SUM(A1)\n@cmd'}]);
 assert.ok(csv.startsWith('\uFEFF"活動編號"'));
 assert.match(csv,/"'=HYPERLINK\(""x""\)"/);assert.match(csv,/"'\+SUM\(A1\)/);
 assert.match(csv,/2026-11-24 14:30/);assert.match(csv,/適中/);assert.match(csv,/願意/);
 assert.doesNotMatch(csv,/Email|姓名|token|邀請/i);
});

test('答案驗證：七題必填、選項限定、建議最多 2000 字且可留空',()=>{
 assert.equal(validateFeedback({...answers,comment:'  '}).comment,null);
 assert.throws(()=>validateFeedback({...answers,difficulty:'??'}),err=>!!err.details.difficulty);
 assert.throws(()=>validateFeedback({...answers,comment:'字'.repeat(2001)}),err=>!!err.details.comment);
 assert.equal(validateFeedback({...answers,comment:'😀'.repeat(2000)}).comment.length,4000);
 assert.throws(()=>validateFeedback({...answers,instructor_rating:'5'}),err=>!!err.details.instructor_rating);
});

test('排程處理課程回饋：資格變更後不寄出（已填寫、取消報名、表單關閉）',async()=>{
 const e=env(),id=await opened(e);const off={...e,MAIL_MODE:'disabled'};await send(off,id);
 e.sqlite.exec("UPDATE registrations SET status='cancelled',updated_at='2026-10-05T00:00:00.000Z' WHERE id='r2'");
 await call(e,'POST',`feedback/${id}/close`);await call(e,'POST',`feedback/${id}/publish`);
 e.sqlite.exec("UPDATE feedback_invitations SET used_at='2026-10-20T00:00:00.000Z',submission_id='s' WHERE registration_id='r5'");
 await processJobs(e,new Date());
 const st=Object.fromEntries(e.sqlite.prepare("SELECT registration_id,status FROM email_jobs WHERE kind='feedback_invite'").all().map(r=>[r.registration_id,r.status]));
 assert.deepEqual(st,{r1:'accepted',r2:'cancelled',r5:'cancelled'});
});
