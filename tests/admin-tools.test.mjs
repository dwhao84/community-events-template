import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {adminAPI,publicData,publicForm,register} from '../src/api.js';
import {feeText,feeInput,validateAbout,defaultAbout} from '../src/admin-tools.js';
import {sessionICS,fold,icsEscape,googleCalendarURL} from '../src/calendar.js';
import {bootstrapAdmin} from '../src/auth.js';
import {handle} from '../src/worker.js';
import {payloadFor,jobEligible} from '../src/mail.js';
import {site} from '../src/site.js';

// In-memory D1 with every migration, an R2 stub and two future sessions (dates are set by the test, not by real events).
const migrations=new URL('../migrations/',import.meta.url);
const files=readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort();
const T0='2026-01-01T00:00:00.000Z',START='2099-05-01T06:00:00.000Z',END='2099-05-01T08:00:00.000Z';
function env(extra=''){
 const sqlite=new DatabaseSync(':memory:');for(const f of files)sqlite.exec(readFileSync(new URL(f,migrations),'utf8'));
 sqlite.exec(`UPDATE settings SET value='true' WHERE key='operating_ready';
  UPDATE settings SET value='"v1"' WHERE key='privacy_version';
  INSERT INTO events(id,title,status,default_form_id,contact,created_at,updated_at) VALUES('ev','社區講座','published','form1','organizer@example.com','${T0}','${T0}');
  INSERT INTO form_versions VALUES('form1','ev',1,'published','${JSON.stringify([{id:'name',type:'text',label:'姓名',required:true,enabled:true},{id:'email',type:'text',label:'Email',required:true,enabled:true},{id:'participant_count',type:'number',label:'人數',required:true,enabled:true,min:1,max:100}])}','${T0}');
  INSERT INTO event_sessions(id,event_id,starts_at,ends_at,location,capacity,fee,fee_type,status,registration_open,max_seats_per_registration,reminder_at,created_at,updated_at) VALUES('s1','ev','${START}','${END}','活動中心, 2F',4,'免費','free','published',1,3,'2099-04-30T01:00:00.000Z','${T0}','${T0}');
  ${extra}`);
 const prepare=sql=>({args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){const r=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}});
 const objects=new Map();
 return {sqlite,objects,APP_ENV:'development',SITE_URL:'https://events.example.org',PHOTOS:{async put(k,v,o){objects.set(k,{v,o});},async get(k){const x=objects.get(k);return x?{body:x.v,httpMetadata:x.o?.httpMetadata}:null;},async delete(k){objects.delete(k);}},
  DB:{prepare,async batch(list){sqlite.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
const everything=['events','registrations','checkin','photos','notifications','export','feedback','admins'];
function call(e,method,path,body={},permissions=everything,raw){
 const url=new URL('https://events.example.org/api/admin/'+path);
 return adminAPI(raw||{method,headers:new Headers()},e,{email:'staff@example.com',permissions},url,url.pathname.split('/').filter(Boolean).slice(2),body);
}
const rejects=(promise,status,pattern)=>assert.rejects(promise,err=>err.status===status&&(!pattern||pattern.test(err.message)));
const n=(e,sql,...a)=>e.sqlite.prepare(sql).get(...a).n;
const sid=()=>crypto.randomUUID();
const resident=(e,body)=>register(new Request('https://events.example.org/api/sessions/s1/registrations'),e,'s1',body);
async function residentBody(e,seats=1,email='r@example.com'){const f=await publicForm(e,'s1');return {form_id:f.form.id,privacy_version:f.privacy.version,privacy_consent:true,participation_consent:true,submission_id:sid(),answers:{name:'住戶',email,participant_count:seats}};}
const png=()=>{const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(b.buffer).setUint32(16,1200);new DataView(b.buffer).setUint32(20,600);return b;};

test('收費文字由結構化欄位組成；收費須有有效金額',()=>{
 assert.equal(feeText('free',null),'免費');assert.equal(feeText('tbd',null,'忽略'),'待定');
 assert.equal(feeText('paid',1200,'現場收現金'),'每人 1,200 元（現場收現金）');
 assert.throws(()=>feeInput({fee_type:'paid',fee_amount:''}),e=>e.status===400);
 assert.throws(()=>feeInput({fee_type:'gift'}),e=>e.status===400);
 assert.deepEqual(feeInput({},{fee:'免費'}),{fee_type:'free',fee_amount:null,fee_note:'',fee:'免費'});
});

test('場次儲存結構化收費與每筆人數上限；收費待定不得開放報名',async()=>{
 const e=env();
 await call(e,'PATCH','sessions/s1',{fee_type:'paid',fee_amount:150,fee_note:'含材料',max_seats_per_registration:5,capacity:4});
 const s=e.sqlite.prepare('SELECT fee,fee_type,fee_amount,max_seats_per_registration FROM event_sessions WHERE id=?').get('s1');
 assert.deepEqual({...s},{fee:'每人 150 元（含材料）',fee_type:'paid',fee_amount:150,max_seats_per_registration:5});
 await rejects(call(e,'PATCH','sessions/s1',{fee_type:'tbd',registration_open:true}),400);
});

test('每筆報名人數上限：表單顯示上限，API 與觸發器都拒絕超額',async()=>{
 const e=env();const f=await publicForm(e,'s1');assert.equal(f.form.fields.find(x=>x.id==='participant_count').max,3);
 await rejects(resident(e,await residentBody(e,4)),400);
 // Even if a form version allows more, the API applies the session limit.
 e.sqlite.exec(`UPDATE event_sessions SET max_seats_per_registration=2 WHERE id='s1'`);const body=await residentBody(e,3);e.sqlite.exec(`UPDATE event_sessions SET max_seats_per_registration=3 WHERE id='s1'`);
 e.sqlite.exec(`UPDATE event_sessions SET max_seats_per_registration=2 WHERE id='s1'`);await rejects(resident(e,body),400);e.sqlite.exec(`UPDATE event_sessions SET max_seats_per_registration=3 WHERE id='s1'`);
 assert.equal(n(e,'SELECT count(*) n FROM registrations'),0);
 assert.throws(()=>e.sqlite.exec(`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,status,seats,answers_json,consent_at,consent_version,consent_json,submission_id,created_at,updated_at) VALUES('x','s1','DN-X','a','a@x.org','a@x.org','form1','pending',4,'{}','${T0}','v','{}','sx','${T0}','${T0}')`),/seat_limit_exceeded/);
 const ok=await resident(e,await residentBody(e,3));assert.equal(ok.status,'pending');
});

test('Turnstile 報名：缺 token 或驗證失敗不寫入、不寄信；同一提交重試不需第二個 token',async()=>{
 const e=Object.assign(env(),{TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'}),original=globalThis.fetch,seen=[];
 let verdict={success:true};globalThis.fetch=async(url,init)=>{seen.push(init.body.get('response'));return Response.json(verdict);};
 try{
  assert.equal((await publicForm(e,'s1')).turnstile_site_key,'1x00000000000000000000AA');
  const body=await residentBody(e,1);
  await rejects(resident(e,body),400,/真人/);assert.equal(seen.length,0,'缺 token 不呼叫 siteverify');
  verdict={success:false};await rejects(resident(e,{...body,turnstile_token:'bad'}),400);
  assert.equal(n(e,'SELECT COUNT(*) n FROM registrations'),0);assert.equal(n(e,'SELECT COUNT(*) n FROM email_jobs'),0);
  verdict={success:true};const ok=await resident(e,{...body,turnstile_token:'good'});assert.equal(ok.status,'pending');
  // Network retry of the same submission: the token is spent, the original result comes back without a new check.
  verdict={success:false};assert.deepEqual({...await resident(e,{...body,turnstile_token:'good'})},{...ok});
  assert.deepEqual(seen,['bad','good']);assert.equal(n(e,"SELECT COUNT(*) n FROM email_jobs WHERE kind='receipt'"),1);
 }finally{globalThis.fetch=original;}
});

test('行事曆檔：UTC 時間、跳脫特殊字元、長行折疊、取消狀態；隱藏或刪除的活動回 404',async()=>{
 const ics=sessionICS({id:'s1',event_id:'ev',title:'講座；第一場, 歡迎',starts_at:START,ends_at:END,location:'活動中心, 2F',fee:'免費',status:'published',revision:1},{siteUrl:'https://events.example.org',host:'events.example.org',now:new Date(T0)});
 assert.match(ics,/DTSTART:20990501T060000Z\r\n/);assert.match(ics,/DTEND:20990501T080000Z/);assert.match(ics,/SUMMARY:講座\\；第一場\\, 歡迎|SUMMARY:講座；第一場\\, 歡迎/);
 assert.match(ics,/LOCATION:活動中心\\, 2F/);assert.match(ics,/STATUS:CONFIRMED/);assert.ok(ics.split('\r\n').every(l=>new TextEncoder().encode(l).length<=75));
 assert.equal(icsEscape('a;b,c\\d\ne'),'a\\;b\\,c\\\\d\\ne');
 const long='DESCRIPTION:'+'很長的說明'.repeat(30);assert.ok(fold(long).split('\r\n ').every(p=>new TextEncoder().encode(p).length<=75));assert.equal(fold(long).split('\r\n ').join(''),long);
 assert.match(sessionICS({id:'s1',title:'x',starts_at:START,ends_at:END,status:'cancelled'}),/STATUS:CANCELLED/);
 const g=new URL(googleCalendarURL({title:'講座',starts_at:START,ends_at:END,location:'活動中心'}));assert.equal(g.searchParams.get('dates'),'20990501T060000Z/20990501T080000Z');assert.equal(g.searchParams.get('action'),'TEMPLATE');
 const e=env();const res=await handle(new Request('https://events.example.org/api/sessions/s1/calendar.ics'),e);
 assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/calendar/);const body=await res.text();assert.match(body,/UID:s1@events\.example\.org/);assert.doesNotMatch(body,/@example\.com/);
 await call(e,'POST','events/ev/hide',{hidden:true});assert.equal((await handle(new Request('https://events.example.org/api/sessions/s1/calendar.ics'),e)).status,404);
});

test('新增活動精靈：一次建立活動、標準表單與場次並開放報名；未完成營運設定不得開放',async()=>{
 const e=env();
 const quick={title:'手作課',contact:'0912-000-000',open:true,session:{starts_at:START,ends_at:END,location:'教室',capacity:12,fee_type:'paid',fee_amount:200,max_seats_per_registration:4}};
 const out=await call(e,'POST','events/quick',quick);
 const ev=e.sqlite.prepare('SELECT status,default_form_id FROM events WHERE id=?').get(out.id);assert.equal(ev.status,'published');assert.equal(ev.default_form_id,out.form_id);
 const f=await publicForm(e,out.session_id);assert.deepEqual(f.form.fields.map(x=>x.id),['name','email','phone','participant_count']);assert.equal(f.form.fields.at(-1).max,4);assert.equal(f.session.fee,'每人 200 元');
 assert.ok((await publicData(e)).events.some(x=>x.id===out.id));
 await rejects(call(e,'POST','events/quick',{...quick,session:{...quick.session,fee_type:'tbd'}}),400);
 assert.equal(n(e,"SELECT count(*) n FROM events WHERE title='手作課'"),1,'failed create leaves nothing behind');
 e.sqlite.exec(`UPDATE settings SET value='false' WHERE key='operating_ready'`);await rejects(call(e,'POST','events/quick',quick),400,/個資告知/);
 const draft=await call(e,'POST','events/quick',{...quick,open:false});assert.equal(e.sqlite.prepare('SELECT status FROM events WHERE id=?').get(draft.id).status,'draft');
});

test('隱藏活動：前台與報名 API 消失，既有報名與通知不受影響；複製活動沿用表單',async()=>{
 const e=env();const r=await resident(e,await residentBody(e,2));
 await call(e,'POST','events/ev/hide',{hidden:true});
 assert.equal((await publicData(e)).events.length,0);await rejects(publicForm(e,'s1'),404);
 assert.equal(e.sqlite.prepare('SELECT status FROM registrations WHERE code=?').get(r.code).status,'pending');
 assert.equal(n(e,"SELECT count(*) n FROM email_jobs WHERE status='pending'"),1);
 await call(e,'POST','events/ev/hide',{hidden:false});assert.equal((await publicData(e)).events.length,1);
 const copy=await call(e,'POST','events/ev/duplicate');assert.equal(copy.session_template.capacity,4);
 const c=e.sqlite.prepare('SELECT status,title,default_form_id FROM events WHERE id=?').get(copy.id);assert.equal(c.status,'draft');assert.match(c.title,/複本/);
 assert.equal(e.sqlite.prepare('SELECT fields_json FROM form_versions WHERE id=?').get(c.default_form_id).fields_json,e.sqlite.prepare("SELECT fields_json FROM form_versions WHERE id='form1'").get().fields_json);
});

test('刪除活動：有效報名須先取消活動；名稱須相符；刪除後可復原且預設隱藏',async()=>{
 const e=env();await resident(e,await residentBody(e,1));
 await rejects(call(e,'POST','events/ev/delete',{confirm_title:'社區講座'}),409,/已取消/);
 await call(e,'PATCH','events/ev',{status:'cancelled'});
 await rejects(call(e,'POST','events/ev/delete',{confirm_title:'別的名稱'}),400);
 await call(e,'POST','events/ev/delete',{confirm_title:'社區講座'});
 assert.equal((await call(e,'GET','events')).length,0);assert.equal((await call(e,'GET','events?deleted=1')).length,1);
 assert.equal(n(e,'SELECT count(*) n FROM registrations'),1,'registrations are kept');
 await rejects(call(e,'PATCH','events/ev',{title:'改名'}),409);
 await call(e,'POST','events/ev/restore');const ev=e.sqlite.prepare("SELECT deleted_at,hidden FROM events WHERE id='ev'").get();assert.equal(ev.deleted_at,null);assert.equal(ev.hidden,1);
 await rejects(call(e,'POST','events/ev/delete',{confirm_title:'社區講座'},['registrations']),403);
});

test('後台代填報名：容量、Email 重複、重試、額滿改候補、不寄通知與無 Email',async()=>{
 const e=env();const base={session_id:'s1',name:'王阿姨',consent_confirmed:true};
 await rejects(call(e,'POST','registrations',{...base,consent_confirmed:false,submission_id:sid(),seats:1}),400,/同意/);
 const first={...base,consent_confirmed:true,email:'w@example.com',seats:3,status:'confirmed',submission_id:sid()};
 const a=await call(e,'POST','registrations',first);assert.equal(a.status,'confirmed');assert.equal(a.seats,3);
 assert.deepEqual((await call(e,'POST','registrations',first)).code,a.code,'retry returns the same registration');
 assert.equal(n(e,"SELECT count(*) n FROM email_jobs WHERE registration_id=? AND kind='confirmation'",a.id),1);
 assert.equal(n(e,"SELECT count(*) n FROM email_jobs WHERE registration_id=? AND kind='reminder'",a.id),1);
 await rejects(call(e,'POST','registrations',{...first,submission_id:sid()}),409,/已報名/);
 await assert.rejects(call(e,'POST','registrations',{...base,email:'x@example.com',seats:2,status:'confirmed',submission_id:sid()}),/capacity_exceeded/,'full session rejects the whole group');
 assert.equal(n(e,"SELECT count(*) n FROM registrations WHERE normalized_email='x@example.com'"),0);
 const w=await call(e,'POST','registrations',{...base,email:'y@example.com',seats:2,status:'confirmed',waitlist_if_full:true,submission_id:sid()});assert.equal(w.status,'waitlisted');
 const big=await call(e,'POST','registrations',{...base,email:'z@example.com',seats:8,status:'waitlisted',submission_id:sid()});assert.equal(big.seats,8,'organizer entries are exempt from the per-registration limit');
 const quiet=await call(e,'POST','registrations',{...base,name:'電話報名',seats:1,status:'pending',notify:false,submission_id:sid()});
 assert.equal(n(e,"SELECT count(*) n FROM email_jobs WHERE registration_id=? AND status<>'cancelled'",quiet.id),0);
 const row=e.sqlite.prepare('SELECT email,normalized_email,created_by_admin,consent_version FROM registrations WHERE id=?').get(quiet.id);
 assert.equal(row.email,'');assert.match(row.normalized_email,/^no-email:/);assert.equal(row.created_by_admin,'staff@example.com');assert.match(row.consent_version,/admin-entered$/);
 const job={registration_id:quiet.id,kind:'receipt'};assert.equal(await jobEligible(e.DB,job,new Date().toISOString()),false,'no email: never sent');
 await rejects(call(e,'POST','registrations',{...base,seats:1,submission_id:sid()},['checkin']),403);
});

test('刪除報名者：只能刪除已取消的報名，並清除相關通知與報到資料',async()=>{
 const e=env();const r=await call(e,'POST','registrations',{session_id:'s1',name:'甲',email:'a@example.com',seats:1,status:'confirmed',consent_confirmed:true,submission_id:sid()});
 await rejects(call(e,'POST',`registrations/${r.id}/purge`),409);
 await call(e,'PATCH',`registrations/${r.id}`,{status:'cancelled'});
 await call(e,'POST',`registrations/${r.id}/purge`);
 for(const t of ['registrations WHERE id=?','email_jobs WHERE registration_id=?'])assert.equal(n(e,`SELECT count(*) n FROM ${t}`,r.id),0);
 const log=e.sqlite.prepare("SELECT summary FROM audit_logs WHERE action='registration.purge'").get();assert.equal(log.summary,'{}');
 assert.ok(n(e,"SELECT count(*) n FROM audit_logs WHERE action='registration.purge' AND target=?",r.id));
});

test('統計：區分有效報名、已確認、候補、取消與實際出席人次，並可匯出 CSV',async()=>{
 const e=env();
 const a=await call(e,'POST','registrations',{session_id:'s1',name:'甲',email:'a@example.com',seats:2,status:'confirmed',consent_confirmed:true,submission_id:sid()});
 await call(e,'POST','registrations',{session_id:'s1',name:'乙',email:'b@example.com',seats:1,status:'pending',consent_confirmed:true,submission_id:sid()});
 await call(e,'POST','registrations',{session_id:'s1',name:'丙',email:'c@example.com',seats:3,status:'waitlisted',consent_confirmed:true,submission_id:sid()});
 const d=await call(e,'POST','registrations',{session_id:'s1',name:'丁',email:'d@example.com',seats:1,status:'pending',consent_confirmed:true,submission_id:sid()});
 await call(e,'PATCH',`registrations/${d.id}`,{status:'cancelled'});
 e.sqlite.exec(`INSERT INTO checkins VALUES('${a.id}','s1','免費','${T0}','staff@example.com');INSERT INTO checkin_attendees VALUES('${a.id}',1,'甲','${T0}'),('${a.id}',2,'甲的家人','${T0}');`);
 const s=await call(e,'GET','stats?year=2099');const row=s.sessions[0];
 assert.deepEqual([row.registered_people,row.confirmed_people,row.pending_people,row.waitlisted_people,row.cancelled_registrations,row.attended_people],[3,2,1,3,1,2]);
 assert.equal(s.totals.registered_people,3);assert.deepEqual(s.years,['2099']);assert.equal((await call(e,'GET','stats?year=2098')).sessions.length,0);
 await rejects(call(e,'GET','stats/export',{},['events']),403);
 const csv=await (await call(e,'GET','stats/export')).text();assert.match(csv,/實際出席人次/);assert.match(csv,/社區講座/);
});

test('Banner：須先上傳圖片與替代文字；只顯示上架中且在期間內的項目；刪除時移除未使用的圖檔',async()=>{
 const e=env();const bytes=png();
 const raw={method:'POST',headers:new Headers({'content-length':String(bytes.length)}),body:new Blob([bytes]).stream()};
 const img=await call(e,'POST','site-images?alt=x',undefined,everything,raw);assert.equal(img.width,1200);assert.equal(e.objects.size,1);
 await rejects(call(e,'POST','banners',{image_id:img.id,alt:''}),400);
 await rejects(call(e,'POST','banners',{image_id:img.id,alt:'封面',link_url:'javascript:alert(1)'}),400);
 const b1=await call(e,'POST','banners',{image_id:img.id,alt:'封面',title:'夏日市集',status:'published',event_id:'ev'});
 await call(e,'POST','banners',{image_id:img.id,alt:'未來',status:'published',starts_at:'2099-01-01T00:00:00Z'});
 await call(e,'POST','banners',{image_id:img.id,alt:'下架',status:'hidden'});
 let pub=(await publicData(e)).banners;assert.deepEqual(pub.map(b=>b.alt),['封面']);assert.equal(pub[0].width,1200);
 await call(e,'POST','events/ev/hide',{hidden:true});assert.equal((await publicData(e)).banners.length,0,'banner of a hidden event is hidden too');
 const media=await handle(new Request(`https://events.example.org/media/${img.id}`),e);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');
 const list=await call(e,'GET','banners');await call(e,'POST',`banners/${list[2].id}/move`,{direction:'up'});assert.equal((await call(e,'GET','banners'))[1].id,list[2].id);
 for(const b of await call(e,'GET','banners'))await call(e,'POST',`banners/${b.id}/delete`);
 assert.equal(e.objects.size,0,'image removed once no banner uses it');assert.equal(n(e,'SELECT count(*) n FROM site_images'),0);
 await rejects(call(e,'GET','banners',{},['events']),403);void b1;
});

test('關於我們區塊：驗證類型與連結、保留版型設定，未設定時使用 site.config.json',async()=>{
 const e=env();
 assert.equal(defaultAbout()[0].type,'hero');assert.equal((await (await handle(new Request('https://events.example.org/api/about'),e)).json()).blocks[0].type,'hero');
 const blocks=[{type:'hero',title:'我們是誰',text:'社區小隊',tone:'accent'},{type:'cards',heading:'在做的事',columns:4,items:[{title:'講座',text:'每月一場'}],align:'center'},{type:'links',heading:'連結',items:[{label:'官網',url:'https://example.org'},{label:'電話',url:'tel:0212345678'}]},{type:'contact',body:'信箱 hi@example.org'}];
 const out=await call(e,'PUT','about',{blocks});assert.equal(out.blocks[1].columns,4);assert.equal(out.blocks[1].align,'center');assert.equal(out.blocks[0].tone,'accent');
 assert.deepEqual((await (await handle(new Request('https://events.example.org/api/about'),e)).json()).blocks.map(b=>b.type),['hero','cards','links','contact']);
 await rejects(validateAbout(e.DB,[{type:'links',items:[{label:'x',url:'javascript:alert(1)'}]}]),400);
 await rejects(validateAbout(e.DB,[{type:'html',body:'<script>'}]),400);
 await rejects(validateAbout(e.DB,[{type:'image_text',image_id:'missing',alt:'x'}]),400);
 await rejects(call(e,'PUT','about',{blocks},['photos']),403);
});

test('自訂頁面：名稱（選單分頁）、是否顯示與內容由主辦方設定並立即生效；預設中性且不顯示；舊網址轉址；使用中的圖片不會被 Banner 刪除帶走',async()=>{
 const e=env();const pub=async()=>(await (await handle(new Request('https://events.example.org/api/page'),e)).json());
 const {defaultCustomPage}=await import('../src/custom-page.js');
 let p=await pub();assert.equal(p.title,'社區資訊');assert.equal(p.show_link,false);assert.deepEqual(p.blocks,defaultCustomPage());
 assert.deepEqual(await validateAbout(e.DB,defaultCustomPage()),defaultCustomPage(),'預設內容符合區塊規則');
 assert.doesNotMatch(JSON.stringify(p),/防詐/,'預設不含防詐內容');
 const admin=await call(e,'GET','page');assert.equal(admin.blocks,null);assert.equal(admin.templates,undefined);
 const out=await call(e,'PUT','page',{title:'垃圾清運時間',show_link:true,blocks:[{type:'hero',title:'垃圾清運',text:'每週一三五晚上'},{type:'links',items:[{label:'清潔隊',url:'tel:1999'}]}]});
 assert.equal(out.title,'垃圾清運時間');assert.equal(out.show_link,true);
 p=await pub();assert.equal(p.title,'垃圾清運時間');assert.equal(p.show_link,true);assert.deepEqual(p.blocks.map(b=>b.title||b.type),['垃圾清運','links'],'儲存後公開 API 立即是新內容');
 assert.deepEqual((await publicData(e)).custom_page,{title:'垃圾清運時間',show_link:true});
 await call(e,'PUT','page',{title:'社區公約',show_link:false,blocks:[{type:'text',body:'請愛護公共空間'}]});assert.deepEqual(await pub().then(x=>[x.title,x.show_link]),['社區公約',false]);
 await rejects(call(e,'PUT','page',{title:' ',blocks:[]}),400,/頁面名稱/);
 await rejects(call(e,'PUT','page',{title:'x'.repeat(31),blocks:[]}),400);
 await rejects(call(e,'PUT','page',{title:'x',blocks:[{type:'links',items:[{label:'x',url:'javascript:alert(1)'}]}]}),400);
 await rejects(call(e,'PUT','page',{title:'x',blocks:[]},['photos']),403);
 assert.notEqual((await call(e,'GET','about')).blocks?.[0]?.title,'垃圾清運','關於我們不受影響');
 const old=await handle(new Request('https://events.example.org/safety.html'),e);assert.equal(old.status,301);assert.equal(old.headers.get('location'),'https://events.example.org/page.html');
 const bytes=png(),raw={method:'POST',headers:new Headers({'content-length':String(bytes.length)}),body:new Blob([bytes]).stream()};
 const img=await call(e,'POST','site-images?alt=x',undefined,everything,raw);
 await call(e,'PUT','page',{title:'公告',show_link:false,blocks:[{type:'image_text',image_id:img.id,alt:'海報',body:'說明'}]});
 const banner=await call(e,'POST','banners',{image_id:img.id,alt:'海報',status:'published'});await call(e,'POST',`banners/${banner.id}/delete`);
 assert.equal(e.objects.size,1,'自訂頁面仍在使用的圖片保留');
});

test('第一位管理員：只在尚無管理員時授權 ADMIN_BOOTSTRAP_EMAIL',async()=>{
 const e=env();e.ADMIN_BOOTSTRAP_EMAIL='Owner@Example.com';
 assert.equal(await bootstrapAdmin(e,'someone@example.com'),false);assert.equal(n(e,'SELECT count(*) n FROM admin_permissions'),0);
 assert.equal(await bootstrapAdmin(e,'owner@example.com'),true);assert.equal(n(e,"SELECT count(*) n FROM admin_permissions WHERE email='owner@example.com'"),8);
 assert.equal(n(e,"SELECT count(*) n FROM audit_logs WHERE action='admin.bootstrap'"),1);
 e.sqlite.exec("DELETE FROM admin_permissions WHERE email='owner@example.com'");e.sqlite.exec("INSERT INTO admin_permissions VALUES('other@example.com','admins')");
 assert.equal(await bootstrapAdmin(e,'owner@example.com'),false,'ignored once any admin exists');
 const none=env();assert.equal(await bootstrapAdmin(none,'owner@example.com'),false,'unset variable never grants');
});

test('通知信附上行事曆連結（需設定 SITE_URL），且不含報名者以外的個資',async()=>{
 const e=env();const r=await call(e,'POST','registrations',{session_id:'s1',name:'甲',email:'a@example.com',seats:1,status:'confirmed',consent_confirmed:true,submission_id:sid()});
 const job=e.sqlite.prepare("SELECT * FROM email_jobs WHERE registration_id=? AND kind='confirmation'").get(r.id);
 const p=await payloadFor(e.DB,job,e);assert.match(p.html,/加入行事曆/);assert.match(p.html,/https:\/\/events\.example\.org\/api\/sessions\/s1\/calendar\.ics/);
 const noSite=await payloadFor(e.DB,job,{...e,SITE_URL:''});assert.doesNotMatch(noSite.html,/加入行事曆/);
});

test('網站配色：預設維持原色；預設與自訂配色可切換；對比不足拒絕；/theme.css 跟著設定',async()=>{
 const {themeCSS,paletteProblems}=await import('../src/theme-css.js');const {themes}=await import('../src/themes.js');
 assert.match(themeCSS('ocean'),/--c-dff4ff:#dff4ff/);assert.doesNotMatch(themeCSS('ocean'),/--blue:/,'default leaves named variables alone');
 assert.match(themeCSS('forest'),/--blue:#2f855a/);assert.doesNotMatch(themeCSS('forest'),/--c-dff4ff:#dff4ff/);
 for(const t of themes)assert.deepEqual(paletteProblems(t),[],t.id);
 const e=env();const css=async(q='')=>{const r=await handle(new Request('https://events.example.org/theme.css'+q),e);assert.match(r.headers.get('content-type'),/text\/css/);return r.text();};
 const stock=themes.find(t=>t.id===site.theme)?.id||themes[0].id;// default follows site.config.json theme
 assert.match(await css(),new RegExp(`site colors: ${stock}`));
 assert.equal((await call(e,'GET','appearance')).presets.length,themes.length);
 await call(e,'PUT','appearance',{theme:'sakura'});assert.match(await css(),/site colors: sakura/);
 await rejects(call(e,'PUT','appearance',{theme:'neon'}),400);
 await rejects(call(e,'PUT','appearance',{theme:{id:'custom',brand:'#ffff00',deep:'#eeeeee',action:'#ffee00',ink:'#cccccc',accent:'#ffffff'}}),400,/對比不足/);
 await rejects(call(e,'PUT','appearance',{theme:{id:'custom',brand:'red'}}),400);
 const good={id:'custom',brand:'#1d4ed8',deep:'#1e3a8a',action:'#15803d',ink:'#111827',accent:'#fbbf24'};
 await call(e,'PUT','appearance',{theme:good});const c=await css();assert.match(c,/site colors: custom/);assert.match(c,/--green:#15803d/);
 assert.match(await css('?preview=1&theme=night'),/^\/\* site colors: night \*\/\n\.theme-preview\{/);
 assert.match(await css('?preview=1&theme=ocean'),/\.theme-preview\{[^}]*--blue:#0769c8/,'preview of the default still sets explicit colors');
 assert.match(await css('?preview=1&brand=%23000000'),new RegExp(`site colors: ${stock}|\\.theme-preview`));
 const etag=(await handle(new Request('https://events.example.org/theme.css'),e)).headers.get('etag');assert.equal((await handle(new Request('https://events.example.org/theme.css',{headers:{'if-none-match':etag}}),e)).status,304);
 await rejects(call(e,'PUT','appearance',{theme:'forest'},['events']),403);
});

test('網站圖示：須為 512 與 180 的正方形 PNG；套用到所有 favicon 路徑；恢復預設會刪除檔案',async()=>{
 const e=env();e.ASSETS={fetch:async()=>new Response('default-icon')};
 const pngOf=(w,h)=>{const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(b.buffer).setUint32(16,w);new DataView(b.buffer).setUint32(20,h);return b;};
 const upload=async bytes=>(await call(e,'POST','site-images',undefined,everything,{method:'POST',headers:new Headers({'content-length':String(bytes.length)}),body:new Blob([bytes]).stream()})).id;
 const big=await upload(pngOf(512,512)),small=await upload(pngOf(180,180)),wrong=await upload(pngOf(512,300));
 await rejects(call(e,'PUT','appearance/icon',{icon_id:wrong,apple_id:small}),400,/512×512/);
 await rejects(call(e,'PUT','appearance/icon',{icon_id:big,apple_id:big}),400,/180×180/);
 assert.equal(await (await handle(new Request('https://events.example.org/favicon.ico'),e)).text(),'default-icon');
 await call(e,'PUT','appearance/icon',{icon_id:big,apple_id:small});
 for(const p of ['/favicon.ico','/favicon.svg','/favicon-192.png','/favicon-512.png']){const r=await handle(new Request('https://events.example.org'+p),e);assert.equal(r.headers.get('content-type'),'image/png',p);assert.equal((await r.arrayBuffer()).byteLength,33);}
 const apple=await handle(new Request('https://events.example.org/apple-touch-icon.png'),e);assert.equal(new DataView(await apple.arrayBuffer()).getUint32(16),180);
 const before=e.objects.size;await call(e,'PUT','appearance/icon',{reset:true});
 assert.equal(e.objects.size,before-2,'both icon files removed');assert.equal(await (await handle(new Request('https://events.example.org/favicon.ico'),e)).text(),'default-icon');
 await rejects(call(e,'PUT','appearance/icon',{reset:true},['photos']),403);
});

test('首頁活動依日期排序：即將舉行的最近在前，已結束的排在後面（最近結束的在前）',async()=>{
 const {sortByDate}=await import('../src/api.js');
 const now=Date.parse('2026-12-01T00:00:00+08:00'),s=(starts,ends=starts,status='published')=>({status,starts_at:starts,ends_at:ends});
 const events=[
  {id:'jan',sessions:[s('2027-01-09T10:00:00+08:00')]},
  {id:'none',sessions:[]},
  {id:'oldPast',sessions:[s('2026-10-01T10:00:00+08:00')]},
  {id:'dec20',sessions:[s('2026-12-20T10:00:00+08:00')]},
  {id:'recentPast',sessions:[s('2026-11-20T10:00:00+08:00')]},
  {id:'multi',sessions:[s('2026-11-25T10:00:00+08:00'),s('2026-12-06T07:00:00+08:00'),s('2026-12-03T10:00:00+08:00','2026-12-03T12:00:00+08:00','cancelled')]},
  {id:'ongoing',sessions:[s('2026-11-30T20:00:00+08:00','2026-12-01T02:00:00+08:00')]}];
 assert.deepEqual(sortByDate(events,now).map(e=>e.id),['ongoing','multi','dec20','jan','recentPast','oldPast','none']);
});
