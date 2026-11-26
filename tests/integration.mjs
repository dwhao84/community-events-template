import assert from 'node:assert/strict';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw Error('Integration tests only run on loopback hosts');
const token=process.env.TEST_ADMIN_TOKEN||'local-development-only-change-me';
async function request(path,{method='GET',body,admin=false}={}){
  const headers={Origin:base};
  if(admin)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  const response=await fetch(base+path,{method,headers,body});
  const data=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();
  return {response,data};
}

const home=await request('/');
assert.equal(home.response.status,200);
const site=await request('/site-config.json');
assert.equal(site.response.status,200);assert.ok(site.data.brand);

const me=await request('/api/admin/me',{admin:true});
assert.equal(me.response.status,200);
assert.equal(me.data.local,true);

let result=await request('/api/admin/settings',{method:'PATCH',admin:true,body:{
  privacy_version:'v1.0-test-'+Date.now(),
  privacy_summary:'本機整合測試用告知摘要。',
  privacy_body:'本機整合測試使用假資料，僅驗證報名流程。',
  participation_statement:'我確認測試資料與參加人數正確。',
  operating_ready:true,
}});
assert.equal(result.response.status,200,JSON.stringify(result.data));

// The test creates its own event one week ahead; it never touches organizer data.
const start=new Date(Date.now()+7*86400000);
const quick=await request('/api/admin/events/quick',{method:'POST',admin:true,body:{title:'整合測試活動',contact:'organizer@example.com',open:true,session:{starts_at:start.toISOString(),ends_at:new Date(start.getTime()+3600000).toISOString(),location:'社區活動中心',capacity:50,fee_type:'free',max_seats_per_registration:50}}});
assert.equal(quick.response.status,200,JSON.stringify(quick.data));
const sid=quick.data.session_id;
const form=await request(`/api/sessions/${sid}/form`);
assert.equal(form.response.status,200,JSON.stringify(form.data));

const registration=(email,seats,submission_id)=>({
  form_id:form.data.form.id,submission_id,privacy_version:form.data.privacy.version,privacy_consent:true,participation_consent:true,
  answers:{name:'測試團體',email,participant_count:seats},
});
const submission1=crypto.randomUUID();
const first=await request(`/api/sessions/${sid}/registrations`,{method:'POST',body:registration('group30@example.com',30,submission1)});
assert.equal(first.response.status,201,JSON.stringify(first.data));
assert.equal(first.data.status,'pending');
assert.equal(first.data.seats,30);

const duplicate=await request(`/api/sessions/${sid}/registrations`,{method:'POST',body:registration('group30@example.com',30,submission1)});
assert.equal(duplicate.response.status,201);
assert.equal(duplicate.data.code,first.data.code);

const second=await request(`/api/sessions/${sid}/registrations`,{method:'POST',body:registration('group21@example.com',21,crypto.randomUUID())});
assert.equal(second.response.status,201,JSON.stringify(second.data));
assert.equal(second.data.status,'waitlisted');

const registrations=await request(`/api/admin/registrations?session_id=${sid}`,{admin:true});
assert.equal(registrations.response.status,200);
assert.equal(registrations.data.reduce((n,r)=>n+(['pending','confirmed'].includes(r.status)?r.seats:0),0),30);
const waitlisted=registrations.data.find(r=>r.code===second.data.code);
const overbook=await request(`/api/admin/registrations/${waitlisted.id}`,{method:'PATCH',admin:true,body:{status:'confirmed'}});
assert.equal(overbook.response.status,409);

const ics=await request(`/api/sessions/${sid}/calendar.ics`);
assert.equal(ics.response.status,200);assert.match(ics.data,/BEGIN:VEVENT/);

const hide=await request(`/api/admin/events/${quick.data.id}/hide`,{method:'POST',admin:true,body:{hidden:true}});
assert.equal(hide.response.status,200);
assert.equal((await request(`/api/sessions/${sid}/form`)).response.status,404);

console.log('Worker integration: site config, quick event, 30-person booking, idempotency, 21-person waitlist, overbooking guard, calendar, hide — ok');
