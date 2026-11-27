import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {adminAPI,publicForm,register as publicRegister} from '../src/api.js';
import {site} from '../src/site.js';
// Identity choices come from site.config.json; the tests use whatever the community configured.
const [ID_A,ID_B=ID_A]=site.identities;

const migrations=new URL('../migrations/',import.meta.url);
const register=(id,session,code,status,seats)=>`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,status,seats,answers_json,consent_at,consent_version,consent_json,submission_id,created_at,updated_at) VALUES('${id}','${session}','${code}','暱稱${id}','${id}@example.com','${id}@example.com','anti-fraud-v1','${status}',${seats},'{}','2026-10-04T01:00:00.000Z','v1','{}','sub-${id}','2026-10-04T01:00:00.000Z','2026-10-04T01:00:00.000Z');`;

// Applies every migration to in-memory SQLite and exposes the small D1 surface the API uses.
const files=[...readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort(),'../tests/fixtures/sample-event.sql'];
const apply=(sqlite,names)=>{for(const name of names)sqlite.exec(readFileSync(new URL(name,migrations),'utf8'));};
function env(){
 const sqlite=new DatabaseSync(':memory:');
 apply(sqlite,files);
 sqlite.exec(`
  UPDATE events SET status='published',contact='organizer@example.com' WHERE id='anti-fraud';
  UPDATE event_sessions SET status='published',capacity=50,location='社區活動中心',fee='免費',registration_open=1,opens_at=NULL,closes_at=NULL WHERE id='anti-fraud-20261017';
  INSERT INTO event_sessions(id,event_id,starts_at,ends_at,location,capacity,fee,status,registration_open,reminder_at,created_at,updated_at) VALUES('anti-fraud-extra','anti-fraud','2026-10-18T05:30:00.000Z','2026-10-18T07:00:00.000Z','社區活動中心',50,'100 元','published',1,'2026-10-17T01:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
  ${register('r1','anti-fraud-20261017','DN-0000000A','confirmed',2)}
  ${register('r2','anti-fraud-20261017','DN-0000000B','pending',1)}
  ${register('r3','anti-fraud-20261017','DN-0000000C','waitlisted',1)}
  ${register('r4','anti-fraud-20261017','DN-0000000D','cancelled',1)}
  ${register('r5','anti-fraud-extra','DN-0000000E','confirmed',1)}
 `);
 const prepare=sql=>({args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){const r=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}});
 return {sqlite,DB:{prepare,async batch(list){sqlite.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
function call(e,permissions,method,path,body={}){
 const url=new URL('https://neighbors.test/api/admin/'+path);
 return adminAPI({method},e,{email:'staff@example.com',permissions},url,url.pathname.split('/').filter(Boolean).slice(2),body);
}
const rejects=(promise,status)=>assert.rejects(promise,e=>e.status===status);
const scan=(e,code,session='anti-fraud-20261017')=>call(e,['checkin'],'POST','checkins',{session_id:session,code});

test('場次開始後仍可報到；重複掃描回傳既有紀錄而不新增',async()=>{
 const e=env();
 const first=await scan(e,' dn-0000000a ');
 assert.equal(first.already,false);assert.equal(first.seats,2);assert.deepEqual(first.attendees,[]);
 const again=await scan(e,'DN-0000000A');
 assert.equal(again.already,true);assert.equal(again.checked_in_at,first.checked_in_at);
 assert.equal(e.sqlite.prepare('SELECT COUNT(*) n FROM checkins').get().n,1);
 assert.equal(e.sqlite.prepare("SELECT status FROM registrations WHERE id='r1'").get().status,'confirmed');
 assert.equal(e.sqlite.prepare("SELECT fee_snapshot FROM checkins WHERE registration_id='r1'").get().fee_snapshot,'免費');
 assert.equal((await scan(e,'DN-0000000B')).status,'pending');
 assert.ok((await call(e,['checkin'],'GET','checkins/sessions')).some(s=>s.id==='anti-fraud-20261017'),'check-in staff need no events permission');
 await rejects(call(e,['registrations'],'POST','checkins',{session_id:'anti-fraud-20261017',code:'DN-0000000B'}),403);
});

test('候補、取消、其他場次、未知或格式錯誤的編號不會報到',async()=>{
 const e=env();
 await rejects(scan(e,'DN-0000000C'),409);
 await rejects(scan(e,'DN-0000000D'),409);
 await rejects(scan(e,'DN-0000000E'),409);
 await rejects(scan(e,'DN-FFFFFFFF'),404);
 await rejects(scan(e,'https://example.com'),400);
 await rejects(scan(e,'DN-0000000A','missing-session'),400);
 assert.equal(e.sqlite.prepare('SELECT COUNT(*) n FROM checkins').get().n,0);
});

test('到場者姓名依報名人數限制，可修改、復原後重新報到',async()=>{
 const e=env();
 const {registration_id:rid}=await scan(e,'DN-0000000A');
 await rejects(call(e,['checkin'],'PUT',`checkins/${rid}/attendees`,{names:['甲','乙','丙']}),400);
 await rejects(call(e,['checkin'],'PUT',`checkins/${rid}/attendees`,{names:['甲','  ']}),400);
 await rejects(call(e,['checkin'],'PUT','checkins/r2/attendees',{names:['甲']}),404);
 assert.deepEqual((await call(e,['checkin'],'PUT',`checkins/${rid}/attendees`,{names:[' 王小明 ','李小華']})).attendees,['王小明','李小華']);
 assert.deepEqual((await call(e,['checkin'],'PUT',`checkins/${rid}/attendees`,{names:['王小明']})).attendees,['王小明']);
 const list=await call(e,['checkin'],'GET','checkins?session_id=anti-fraud-20261017');
 assert.equal(list.expected.seats,3);assert.equal(list.checkins[0].named,1);
 assert.doesNotMatch(e.sqlite.prepare("SELECT summary FROM audit_logs WHERE action='checkin.attendees'").all().map(r=>r.summary).join(),/王小明/);
 await call(e,['checkin'],'POST',`checkins/${rid}/undo`);
 assert.equal(e.sqlite.prepare('SELECT COUNT(*) n FROM checkin_attendees').get().n,0);
 assert.equal((await scan(e,'DN-0000000A')).already,false);
});

test('簽到單需要匯出權限，依報到順序列出姓名與收費',async()=>{
 const e=env();
 const a=await scan(e,'DN-0000000A');await call(e,['checkin'],'PUT',`checkins/${a.registration_id}/attendees`,{names:['王小明','李小華']});
 await rejects(call(e,['checkin'],'GET','checkins/sheet?session_id=anti-fraud-20261017'),403);
 await rejects(call(e,['export'],'GET','checkins?session_id=anti-fraud-20261017'),403);
 const sheet=await call(e,['export'],'GET','checkins/sheet?session_id=anti-fraud-20261017');
 assert.equal(sheet.session.event_id,'anti-fraud');
 assert.deepEqual(sheet.rows.map(r=>[r.full_name,r.fee_snapshot]),[['王小明','免費'],['李小華','免費']]);
 const rows=await call(e,['registrations'],'GET','registrations?session_id=anti-fraud-20261017');
 assert.ok(rows.find(r=>r.id==='r1').checked_in_at);
});

test('手寫簽名、選項及姓名一併儲存；匯出受權限保護；錯誤簽名不破壞原紀錄',async()=>{
 const e=env();await scan(e,'DN-0000000A');
 const signature=[[[0.1,0.2],[0.4,0.8],[0.9,0.2]]];
 await call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['王小明'],people:[{signature,age_group:'大',gender:'男',identity:ID_B}]});
 const saved=await scan(e,'DN-0000000A');assert.deepEqual(JSON.parse(saved.people[0].signature_json),signature);
 for(const bad of [[[[2,0]]],[[['NaN',0]]],[],[[[0,0,0]]]])await rejects(call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['錯誤'],people:[{signature:bad}]}),400);
 await rejects(call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['甲','乙','丙'],people:[{},{},{}]}),400);
 await rejects(call(e,[],'PUT','checkins/r1/attendees',{names:['甲']}),403);
 await rejects(call(e,['checkin'],'GET','checkins/sheet?session_id=anti-fraud-20261017'),403);
 const sheet=await call(e,['export'],'GET','checkins/sheet?session_id=anti-fraud-20261017');
 assert.equal(sheet.rows[0].full_name,'王小明');assert.equal(sheet.rows[0].identity,ID_B);assert.deepEqual(JSON.parse(sheet.rows[0].signature_json),signature);
 const audit=e.sqlite.prepare('SELECT * FROM audit_logs').all();assert.doesNotMatch(JSON.stringify(audit),/王小明|signature_json/);
 await call(e,['checkin'],'POST','checkins/r1/undo');assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkin_attendees').get().n,0);
});

test('以姓名搜尋僅回傳本場可報到名單且需報到權限',async()=>{
 const e=env();
 await rejects(call(e,[],'POST','checkins/search',{session_id:'anti-fraud-20261017',query:'暱稱'}),403);
 const rows=await call(e,['checkin'],'POST','checkins/search',{session_id:'anti-fraud-20261017',query:'暱稱'});
 assert.deepEqual(rows.map(r=>r.code).sort(),['DN-0000000A','DN-0000000B']);assert.ok(rows.every(r=>!('email' in r)));
});

 test('報名姓名顯示真實姓名提示但不覆寫已發布表單',async()=>{
 const e=env();const before=e.sqlite.prepare("SELECT fields_json FROM form_versions WHERE id='anti-fraud-v1'").get().fields_json;
 const f=await publicForm(e,'anti-fraud-20261017');assert.equal(f.form.fields.find(f=>f.id==='name').label,'請幫我填寫真實姓名');
 assert.equal(e.sqlite.prepare("SELECT fields_json FROM form_versions WHERE id='anti-fraud-v1'").get().fields_json,before);
 });

test('簽到表所有欄位與個別實收金額直接帶入，修改與無效資料不混淆場次定價',async()=>{
 const e=env();const r=await scan(e,'DN-0000000A');assert.equal(r.nickname,'暱稱r1');assert.equal(r.fee_snapshot,'免費');
 const people=[{age_group:'大',gender:'其他',identity:ID_A,fee_status:'paid',fee_amount:120,signature:[[[0.1,0.2],[0.2,0.3]]]},{age_group:'小',gender:'女',identity:ID_B,fee_status:'free'}];
 await call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['甲','乙'],people});
 const rows=(await call(e,['export'],'GET','checkins/sheet?session_id=anti-fraud-20261017')).rows;
 assert.deepEqual(rows.map(p=>[p.full_name,p.age_group,p.gender,p.identity,p.fee_status,p.fee_amount]),[['甲','大','其他',ID_A,'paid',120],['乙','小','女',ID_B,'free',null]]);
 for(const fee_amount of [-1,0.5,'20',1000001,null])await rejects(call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['甲'],people:[{fee_status:'paid',fee_amount}]}),400);
 await rejects(call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['甲'],people:[{fee_status:'unknown'}]}),400);
 const saved=await scan(e,'DN-0000000A');assert.equal(saved.people[0].fee_amount,120);assert.equal(saved.fee_snapshot,'免費');
 await call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['甲'],people:[{fee_status:'paid',fee_amount:0}]});
 assert.equal((await scan(e,'DN-0000000A')).people[0].fee_amount,0);
});

const onsitePermissions=['checkin','registrations'];
async function onsiteEnv(capacity=10){
 const e=env(),now=Date.now();
 e.sqlite.prepare('UPDATE event_sessions SET starts_at=?,ends_at=?,capacity=? WHERE id=?').run(new Date(now-60000).toISOString(),new Date(now+3600000).toISOString(),capacity,'anti-fraud-20261017');
 e.sqlite.exec("UPDATE settings SET value='true' WHERE key='operating_ready'");
 await call(e,onsitePermissions,'PATCH','checkins/onsite',{session_id:'anti-fraud-20261017',enabled:true});
 const info=await call(e,onsitePermissions,'GET','checkins/onsite?session_id=anti-fraud-20261017');
 const body={session_id:'anti-fraud-20261017',form_id:info.form_id,privacy_version:info.privacy.version,privacy_consent:true,participation_consent:true,submission_id:crypto.randomUUID(),email:'onsite@example.test',names:['現場甲','現場乙'],people:[{age_group:'大',gender:'男',identity:ID_B,signature:[[[0,0],[0.5,0.5]]],fee_status:'free'},{age_group:'小',gender:'女',identity:ID_A,signature:[[[0.2,0.3],[0.6,0.8]]],fee_status:'free'}]};
 return {e,body};
}

test('未報名者現場填表一次完成已確認報名、簽到與簽到表；重試不增加人數或通知',async()=>{
 const {e,body}=await onsiteEnv();
 const first=await call(e,onsitePermissions,'POST','checkins/onsite',body);
 assert.equal(first.status,'confirmed');assert.equal(first.registered,true);assert.equal(first.seats,2);assert.deepEqual(first.attendees,body.names);
 const r=e.sqlite.prepare('SELECT * FROM registrations WHERE submission_id=?').get(body.submission_id);
 assert.equal(r.registration_source,'onsite');assert.equal(JSON.parse(r.consent_json).onsite_consent,true);assert.match(JSON.parse(r.consent_json).onsite_notice,/手寫簽名/);
 const jobs=e.sqlite.prepare('SELECT * FROM email_jobs WHERE registration_id=?').all(r.id);assert.equal(jobs.length,1);assert.equal(jobs[0].kind,'confirmation');
 await call(e,onsitePermissions,'PATCH','checkins/onsite',{session_id:body.session_id,enabled:false});
 const retry=await call(e,onsitePermissions,'POST','checkins/onsite',body);assert.equal(retry.registration_id,first.registration_id);
 assert.equal(e.sqlite.prepare('SELECT COUNT(*) n FROM registrations WHERE submission_id=?').get(body.submission_id).n,1);
 assert.equal(e.sqlite.prepare('SELECT COUNT(*) n FROM email_jobs WHERE registration_id=?').get(r.id).n,1);
 const sheet=await call(e,['export'],'GET','checkins/sheet?session_id='+body.session_id);assert.deepEqual(sheet.rows.map(p=>p.full_name),body.names);
});

test('現場報名檢查權限、版本、同意、簽名及同場 Email，失敗不留下半筆資料',async()=>{
 const {e,body}=await onsiteEnv();
 await rejects(call(e,['checkin'],'POST','checkins/onsite',body),403);
 await rejects(call(e,['registrations'],'POST','checkins/onsite',body),403);
 for(const patch of [{privacy_consent:false},{participation_consent:false},{email:'bad'},{people:body.people.map(p=>({...p,signature:null}))}])await rejects(call(e,onsitePermissions,'POST','checkins/onsite',{...body,...patch}),400);
 for(const patch of [{form_id:'old'},{privacy_version:'old'},{email:'r1@example.com'}])await rejects(call(e,onsitePermissions,'POST','checkins/onsite',{...body,...patch}),409);
 assert.equal(e.sqlite.prepare("SELECT count(*) n FROM registrations WHERE registration_source='onsite'").get().n,0);
 await call(e,onsitePermissions,'POST','checkins/onsite',body);
 await rejects(call(e,onsitePermissions,'POST','checkins/onsite',{...body,submission_id:crypto.randomUUID()}),409);
});

test('多人現場報名容量不足整組拒絕；競爭最後名額只有一組成功',async()=>{
 const {e,body}=await onsiteEnv(4); // Three seats are already held by existing registrations.
 await assert.rejects(call(e,onsitePermissions,'POST','checkins/onsite',body),/capacity_exceeded/);
 assert.equal(e.sqlite.prepare("SELECT count(*) n FROM registrations WHERE registration_source='onsite'").get().n,0);
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkins').get().n,0);
 const original=e.DB.batch.bind(e.DB);let tail=Promise.resolve();e.DB.batch=list=>{const result=tail.then(()=>original(list));tail=result.catch(()=>{});return result;};
 const one={...body,names:[body.names[0]],people:[body.people[0]]};
 const results=await Promise.allSettled([call(e,onsitePermissions,'POST','checkins/onsite',one),call(e,onsitePermissions,'POST','checkins/onsite',{...one,submission_id:crypto.randomUUID(),email:'other@example.test'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(e.sqlite.prepare("SELECT sum(seats) n FROM registrations WHERE status IN ('pending','confirmed') AND session_id=?").get(body.session_id).n,4);
});

test('現場入口必須開放且活動當天尚未結束，線上報名仍禁止開始後寫入',async()=>{
 const {e,body}=await onsiteEnv();
 const attempt=()=>call(e,onsitePermissions,'POST','checkins/onsite',body);
 await call(e,onsitePermissions,'PATCH','checkins/onsite',{session_id:body.session_id,enabled:false});await rejects(attempt(),409);
 e.sqlite.exec('UPDATE onsite_registration_forms SET enabled=1');
 e.sqlite.prepare('UPDATE event_sessions SET ends_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),body.session_id);await rejects(attempt(),409);
 e.sqlite.prepare('UPDATE event_sessions SET starts_at=?,ends_at=? WHERE id=?').run(new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+90000000).toISOString(),body.session_id);await rejects(attempt(),409);
 e.sqlite.prepare('UPDATE event_sessions SET starts_at=?,ends_at=? WHERE id=?').run(new Date(Date.now()-60000).toISOString(),new Date(Date.now()+3600000).toISOString(),body.session_id);
 assert.throws(()=>e.sqlite.exec(register('late',body.session_id,'DN-000000FF','pending',1).replaceAll('2026-10-04T01:00:00.000Z',new Date().toISOString())),/session_or_form_changed/);
 e.sqlite.exec("UPDATE events SET status='cancelled' WHERE id='anti-fraud'");await rejects(attempt(),409);
});

test('新結構可由舊版四欄寫入姓名，回復程式後仍可使用；詳情隨姓名刪除',async()=>{
 const e=env();await scan(e,'DN-0000000A');
 e.sqlite.prepare('INSERT INTO checkin_attendees VALUES(?,?,?,?)').run('r1',1,'舊版姓名',new Date().toISOString());
 const r=await scan(e,'DN-0000000A');assert.equal(r.people[0].full_name,'舊版姓名');assert.equal(r.people[0].signature_json,null);
 await call(e,['checkin'],'PUT','checkins/r1/attendees',{names:['新版姓名'],people:[{signature:[[[0,0],[1,1]]]}]});
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkin_attendee_details').get().n,1);
 e.sqlite.exec("DELETE FROM checkin_attendees WHERE registration_id='r1'");
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkin_attendee_details').get().n,0);
});

async function handwrittenEnv(capacity=10){
 const e=env(),fields=[{id:'name',type:'text',label:'姓名',enabled:true,required:true,maxLength:50},{id:'email',type:'text',label:'Email',enabled:true,required:true,maxLength:254},{id:'participant_count',type:'number',label:'參加人數',enabled:true,required:true,min:1,max:10}];
 e.sqlite.exec("UPDATE settings SET value='true' WHERE key='operating_ready'");
 e.sqlite.prepare('INSERT INTO form_versions VALUES(?,?,?,?,?,?)').run('handwritten-form','anti-fraud',50,'published',JSON.stringify(fields),new Date().toISOString());
 e.sqlite.exec("UPDATE events SET default_form_id='handwritten-form' WHERE id='anti-fraud'");
 e.sqlite.prepare('UPDATE event_sessions SET starts_at=?,ends_at=?,capacity=? WHERE id=?').run(new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+90000000).toISOString(),capacity,'anti-fraud-20261017');
 const f=await publicForm(e,'anti-fraud-20261017'),signature=[[[0.1,0.2],[0.3,0.8],[0.8,0.1]]];
 const body={form_id:f.form.id,privacy_version:f.privacy.version,privacy_consent:true,participation_consent:true,submission_id:crypto.randomUUID(),answers:{name:'',email:'handwritten@example.test',participant_count:2},name_signature:signature};
 const send=b=>publicRegister(new Request('https://neighbors.test/api/sessions/anti-fraud-20261017/registrations'),e,'anti-fraud-20261017',b);
 return {e,body,send,signature};
}

test('居民可只手寫姓名完成報名；重試保留原筆跡、不增加通知，且報名不等於出席',async()=>{
 const {e,body,send,signature}=await handwrittenEnv();const first=await send(body);assert.equal(first.status,'pending');assert.equal(first.seats,2);
 const r=e.sqlite.prepare('SELECT * FROM registrations WHERE submission_id=?').get(body.submission_id);assert.equal(r.name,'');assert.deepEqual(JSON.parse(r.name_signature_json),signature);
 assert.match(JSON.parse(r.consent_json).body,/手寫姓名筆跡/);assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkins').get().n,0);
 const retry=await send({...body,name_signature:[[[0,0],[1,1]]]});assert.deepEqual({...retry},{...first});assert.deepEqual(JSON.parse(e.sqlite.prepare('SELECT name_signature_json FROM registrations WHERE id=?').get(r.id).name_signature_json),signature);
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM email_jobs WHERE registration_id=?').get(r.id).n,1);
 await rejects(send({...body,submission_id:crypto.randomUUID()}),409);
 const found=await call(e,['checkin'],'POST','checkins/search',{session_id:'anti-fraud-20261017',query:body.answers.email});assert.equal(found[0].code,first.code);
 const c=await scan(e,first.code);assert.deepEqual(JSON.parse(c.name_signature_json),signature);
 await call(e,['checkin'],'PUT',`checkins/${c.registration_id}/attendees`,{names:[''],people:[{signature}]});
 const sheet=await call(e,['export'],'GET','checkins/sheet?session_id=anti-fraud-20261017');assert.deepEqual(JSON.parse(sheet.rows[0].signature_json),signature);
});

test('手寫姓名格式、必填、同意與版本有伺服器防護；容量不足仍整組候補',async()=>{
 const {e,body,send}=await handwrittenEnv(4); // Existing registrations reserve three seats.
 await rejects(send({...body,name_signature:null}),400);
 for(const name_signature of ['<svg/>',[],[[[1.1,0]]],[[[null,0]]],[[[0,0,1]]]])await rejects(send({...body,name_signature}),400);
 await rejects(send({...body,privacy_version:'old'}),409);await rejects(send({...body,privacy_consent:false}),400);
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM registrations WHERE submission_id=?').get(body.submission_id).n,0);
 const result=await send(body);assert.equal(result.status,'waitlisted');assert.equal(result.seats,2);assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkins').get().n,0);
});

test('取消後重新報名可換筆跡，既有鍵盤姓名仍可報名',async()=>{
 const {e,body,send}=await handwrittenEnv();const first=await send({...body,answers:{...body.answers,name:'鍵盤姓名'},name_signature:null});
 const r=e.sqlite.prepare('SELECT id FROM registrations WHERE code=?').get(first.code);
 e.sqlite.prepare("UPDATE registrations SET status='cancelled',updated_at=? WHERE id=?").run(new Date().toISOString(),r.id);
 const retry=await send({...body,submission_id:crypto.randomUUID()});assert.equal(retry.code,first.code);
 const saved=e.sqlite.prepare('SELECT generation,name_signature_json FROM registrations WHERE id=?').get(r.id);assert.equal(saved.generation,2);assert.ok(saved.name_signature_json);
});

test('線上報名逐位填寫簽到欄位；伺服器驗證列數與選項，重試不覆寫，報名簽到單依名單帶入且排除候補',async()=>{
 const {e,body,send,signature}=await handwrittenEnv();const f=await publicForm(e,'anti-fraud-20261017');
 assert.deepEqual(f.form.participants.identities,site.identities);assert.match(f.privacy.version,/signin-fields-v1$/);assert.match(f.privacy.body,/性別/);
 const participants=[{name:'',age_group:'大',gender:'女',identity:ID_B},{name:'小明',age_group:'小',gender:'男',identity:ID_A}];
 await rejects(send({...body,participants:participants.slice(0,1)}),400);
 await rejects(send({...body,participants:[participants[0],{...participants[1],name:''}]}),400);
 await rejects(send({...body,participants:[participants[0],{...participants[1],gender:'X'}]}),400);
 await rejects(send({...body,participants:[participants[0],{...participants[1],name:'x'.repeat(51)}]}),400);
 const first=await send({...body,participants});const r=e.sqlite.prepare('SELECT * FROM registrations WHERE submission_id=?').get(body.submission_id);
 assert.deepEqual(JSON.parse(r.participants_json),participants);
 await send({...body,participants:[participants[0],{...participants[1],name:'改名'}]});assert.equal(JSON.parse(e.sqlite.prepare('SELECT participants_json FROM registrations WHERE id=?').get(r.id).participants_json)[1].name,'小明');
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM email_jobs WHERE registration_id=?').get(r.id).n,1);assert.equal(first.seats,2);
 await rejects(call(e,['registrations'],'GET','registrations/sheet?session_id=anti-fraud-20261017'),403);
 const sheet=await call(e,['export'],'GET','registrations/sheet?session_id=anti-fraud-20261017');
 // r1 (confirmed, 2 seats) + r2 (pending, 1) + new registration (2); waitlisted r3 and cancelled r4 are excluded.
 assert.equal(sheet.registrations,3);assert.equal(sheet.rows.length,5);
 assert.deepEqual(sheet.rows.slice(0,3).map(x=>x.full_name),['暱稱r1','','暱稱r2']);
 const mine=sheet.rows.slice(3);assert.deepEqual(JSON.parse(mine[0].signature_json),signature);assert.equal(mine[0].full_name,'');assert.equal(mine[0].identity,ID_B);
 assert.deepEqual({...mine[1]},{full_name:'小明',signature_json:null,age_group:'小',gender:'男',identity:ID_A,fee_snapshot:'免費'});
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM checkins').get().n,0);
 assert.throws(()=>e.sqlite.exec("UPDATE registrations SET participants_json='{}' WHERE id='r1'"));
});
