import test from 'node:test';
import assert from 'node:assert/strict';
import {payloadFor,processJobs} from '../src/mail.js';

function templateDb(){return {prepare(sql){return {bind(){return this;},async first(){return sql.includes('email_templates')?{subject:'通知 {{event_name}}',body:'{{name}}'}:{email:'resident@example.com',name:'里民',title:'社區活動',starts_at:'2030-11-21T05:30:00.000Z',status:'confirmed',seats:1};}};}};}
test('營運通知加入指定 CC，未設定時不加入；無效地址拒絕產生內容',async()=>{
 const env={MAIL_FROM:'team@example.com',MAIL_REPLY_TO:'reply@example.com',MAIL_CC:'cc@example.com'};
 const payload=await payloadFor(templateDb(),{registration_id:'local-test'},env);
 assert.deepEqual(payload.to,['resident@example.com']);
 assert.deepEqual(payload.cc,['cc@example.com']);
 assert.equal(payload.reply_to,'reply@example.com');
 assert.equal((await payloadFor(templateDb(),{registration_id:'local-test'},{MAIL_FROM:env.MAIL_FROM})).cc,undefined);
 await assert.rejects(payloadFor(templateDb(),{registration_id:'local-test'},{...env,MAIL_CC:'invalid'}),/invalid_mail_cc/);
});

test('非正式寄送不可透過已保存的 CC 或 BCC 繞過收件白名單',async()=>{
 for(const field of ['cc','bcc']){
  let fetched=false,failed=false;
  const job={id:'local-test',kind:'test',unique_key:'local-test',attempts:0,payload_json:JSON.stringify({from:'team@example.com',to:['allowed@example.com'],[field]:['outside@example.com'],subject:'測試',text:'測試'})};
  const db={prepare(sql){return {bind(...args){this.args=args;return this;},async run(){return {meta:{changes:1}};},async all(){return {results:sql.includes('SELECT * FROM email_jobs')?[job]:[]};},sql};},async batch(items){failed=items.some(s=>s.args?.includes('test_recipient_not_allowed'));return [];}};
  await processJobs({DB:db,MAIL_MODE:'resend',APP_ENV:'staging',RESEND_API_KEY:'test-only',MAIL_FROM:'team@example.com',TEST_RECIPIENTS:'allowed@example.com'},new Date('2030-01-01T00:00:00Z'),async()=>{fetched=true;throw Error('must not send');});
  assert.equal(fetched,false);
  assert.equal(failed,true);
 }
});

test('正式信件版型依通知類型呈現，保留純文字並安全轉義所有資料',async()=>{
 const {renderTemplate}=await import('../src/mail.js');
 for(const kind of ['receipt','confirmation','reminder','reschedule','cancellation','test']){
  const data={name:'<img src=x onerror=alert(1)>',event_name:'<script>危險</script>',location:'測試地點',status:'已確認',code:'DEMO',seats:2};
  const result=renderTemplate({kind,subject:'通知 {{event_name}}',body:'{{name}} 您好：\n\n{{location}}'},data,{replyTo:'team@example.com'});
  assert.match(result.html,/<!doctype html>/);
  assert.match(result.html,/COMMUNITY EVENTS/);assert.match(result.html,/社區活動報名/);
  assert.match(result.html,/mailto:team@example.com/);
  assert.doesNotMatch(result.html,/<script>|<img/);
  assert.match(result.text,/<img/);
  if(kind==='receipt')assert.match(result.html,/收件通知不代表名額已確認/);
  if(kind==='test')assert.match(result.html,/並非正式報名或名額確認通知/);
  if(kind==='cancellation')assert.match(result.html,/本場活動已取消/);
 }
 const withLinks=renderTemplate({kind:'confirmation',subject:'確認',body:'內容'},{event_name:'課',calendar:{ics:'https://events.example.org/api/sessions/s1/calendar.ics',google:'https://calendar.google.com/calendar/render?action=TEMPLATE&text=%E8%AA%B2'}},{siteUrl:'https://events.example.org'});
 assert.match(withLinks.html,/加入行事曆/);assert.match(withLinks.html,/calendar\.ics/);assert.match(withLinks.html,/action=TEMPLATE&amp;text/);assert.match(withLinks.html,/href="https:\/\/events\.example\.org\/"/);
 assert.doesNotMatch(renderTemplate({kind:'confirmation',subject:'確認',body:'內容'},{}).html,/加入行事曆|前往.*網站/,'no SITE_URL: no site button or calendar links');
 const bad=renderTemplate({kind:'test',subject:'測試',body:'內容'},{},{replyTo:'javascript:alert(1)'});
 assert.doesNotMatch(bad.html,/href="mailto:javascript/);
});

test('所有活動通知不再附 QR Code',async()=>{
 const db=(status)=>({prepare(sql){return {bind(){return this;},async first(){return sql.includes('email_templates')?{kind:'receipt',subject:'通知',body:'{{code}}'}:{email:'resident@example.com',name:'里民',title:'社區活動',starts_at:'2030-11-21T05:30:00.000Z',status,seats:1,code:'DN-1A2B3C4D'};}};}});
 const env={MAIL_FROM:'team@example.com'};
 for(const kind of ['receipt','confirmation','reminder'])for(const status of ['pending','confirmed']){
  const payload=await payloadFor(db(status),{registration_id:'local-test',kind},env);
  assert.equal(payload.attachments,undefined,`${kind}/${status}`);
  assert.doesNotMatch(payload.html,/QR Code|cid:checkin-qr/);
 }
 for(const [kind,status] of [['receipt','waitlisted'],['cancellation','confirmed'],['reschedule','pending']]){
  const payload=await payloadFor(db(status),{registration_id:'local-test',kind},env);
  assert.equal(payload.attachments,undefined,`${kind}/${status}`);
  assert.doesNotMatch(payload.html,/cid:checkin-qr/);
 }
});
