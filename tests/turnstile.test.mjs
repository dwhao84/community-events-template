import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTurnstile,turnstileEnabled,turnstileSiteKey} from '../src/turnstile.js';
import {handle} from '../src/worker.js';

const keys={TURNSTILE_SITE_KEY:'0x4AAAAAAAtest-site_key',TURNSTILE_SECRET_KEY:'0x4AAAAAAAsecret'};
const req=(host='events.example.org')=>new Request(`https://${host}/api/sessions/s1/registrations`,{method:'POST',headers:{'cf-connecting-ip':'203.0.113.9'}});
const rejects=(promise,status,pattern)=>assert.rejects(promise,err=>err.status===status&&(!pattern||pattern.test(err.message)));
function siteverify(result,{ok=true,calls=[]}={}){return async(url,init)=>{calls.push({url,form:Object.fromEntries(init.body)});if(result instanceof Error)throw result;return new Response(JSON.stringify(result),{status:ok?200:500});};}

test('Turnstile 未設定時不啟用；只設一半時拒絕報名（fail closed）',async()=>{
 assert.equal(turnstileEnabled({}),false);await verifyTurnstile(req(),{},undefined,()=>{throw Error('不應呼叫');});
 assert.throws(()=>turnstileEnabled({TURNSTILE_SITE_KEY:keys.TURNSTILE_SITE_KEY}),e=>e.status===503);
 assert.throws(()=>turnstileEnabled({TURNSTILE_SECRET_KEY:'x'}),e=>e.status===503);
 assert.equal(turnstileSiteKey({TURNSTILE_SITE_KEY:'"><script>'}),null,'格式不符的 site key 不會送到前端');
});

test('Turnstile 驗證：缺 token、驗證失敗、服務異常都不放行',async()=>{
 const env={...keys,APP_ENV:'production'};
 await rejects(verifyTurnstile(req(),env,''),400,/真人/);
 await rejects(verifyTurnstile(req(),env,'x'.repeat(2049)),400);
 await rejects(verifyTurnstile(req(),env,'tok',siteverify({success:false,'error-codes':['timeout-or-duplicate']})),400);
 await rejects(verifyTurnstile(req(),env,'tok',siteverify({},{ok:false})),503);
 await rejects(verifyTurnstile(req(),env,'tok',siteverify(new Error('network'))),503);
});

test('正式環境核對 action 與網域；送出 secret、token 與訪客 IP',async()=>{
 const env={...keys,APP_ENV:'production'},calls=[];
 await verifyTurnstile(req(),env,'tok',siteverify({success:true,action:'register',hostname:'events.example.org'},{calls}));
 assert.equal(calls[0].url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
 assert.deepEqual(calls[0].form,{secret:keys.TURNSTILE_SECRET_KEY,response:'tok',remoteip:'203.0.113.9'});
 await rejects(verifyTurnstile(req(),env,'tok',siteverify({success:true,action:'login',hostname:'events.example.org'})),400);
 await rejects(verifyTurnstile(req(),env,'tok',siteverify({success:true,action:'register',hostname:'evil.example'})),400);
 // Cloudflare's test keys report another hostname; that is only accepted outside production.
 await verifyTurnstile(req('localhost'),{...keys,APP_ENV:'development'},'tok',siteverify({success:true,action:'',hostname:'example.com'}));
});

test('首頁 CSP 只在設定 Turnstile 時加入 challenges.cloudflare.com，後台不受影響',async()=>{
 const base={APP_ENV:'production',ASSETS:{fetch:async()=>new Response('ok')}};
 const csp=async(path,env)=>(await handle(new Request('https://events.example.org'+path),env)).headers.get('Content-Security-Policy');
 assert.doesNotMatch(await csp('/',base),/challenges\.cloudflare\.com/);
 const home=await csp('/',{...base,...keys});
 assert.match(home,/script-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/challenges\.cloudflare\.com;/);
 assert.match(home,/frame-src https:\/\/challenges\.cloudflare\.com$/);
 assert.doesNotMatch(home,/unsafe-inline|\*/);
 assert.doesNotMatch(await csp('/about.html',{...base,...keys}),/challenges/);
 assert.doesNotMatch(await csp('/admin/',{...base,...keys,APP_ENV:'development'}),/challenges/);
});
