import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJSONC,checkWrangler,checkSite,configCheck} from '../scripts/config-check.mjs';

const base=()=>({name:'sunshine-events',vars:{APP_ENV:'production',SITE_URL:'https://sunshine-events.example.workers.dev',MAIL_MODE:'disabled',TURNSTILE_SITE_KEY:'0x4AAAAAAAtestkey'},d1_databases:[{binding:'DB',database_name:'sunshine-events'}],r2_buckets:[{binding:'PHOTOS',bucket_name:'sunshine-events-photos'}]});
const errs=w=>checkWrangler(w).errors;

test('設定預檢：JSONC 解析保留字串中的 // 並移除註解與結尾逗號',()=>{
 assert.deepEqual(parseJSONC('{\n // c\n "a": "https://x.org", /* b */ "b": [1,2,],\n}'),{a:'https://x.org',b:[1,2]});
 assert.deepEqual(parseJSONC('{"a":"say \\"//hi\\""}'),{a:'say "//hi"'});
});

test('設定預檢：repo 內的 wrangler.jsonc 與 site.config.json 沒有格式錯誤',()=>{
 assert.deepEqual(configCheck().errors,[]);
});

test('設定預檢：Worker 名稱、SITE_URL 與公開設定格式',()=>{
 assert.deepEqual(errs(base()),[]);
 for(const name of ['Sunshine','my_events','-events','events-','a'.repeat(64),''])assert.equal(errs({...base(),name}).length,1,name);
 const url=u=>errs({...base(),vars:{...base().vars,SITE_URL:u}});
 assert.match(url('https://x.workers.dev/')[0],/結尾不要加 \//);
 assert.equal(url('http://x.workers.dev').length,1);assert.equal(url('https://x.org/path').length,1);
 assert.deepEqual(url(''),[]);assert.match(checkWrangler({...base(),vars:{...base().vars,SITE_URL:''}}).warnings.join(),/SITE_URL/);
 const v=extra=>errs({...base(),vars:{...base().vars,...extra}});
 assert.equal(v({APP_ENV:'development'}).length,1);
 assert.equal(v({MAIL_MODE:'mock'}).length,1);assert.equal(v({MAIL_MODE:'resend'}).length,1);assert.deepEqual(v({MAIL_MODE:'resend',MAIL_FROM:'社區 <team@example.org>'}),[]);
 assert.equal(v({GA4_MEASUREMENT_ID:'UA-123'}).length,1);assert.deepEqual(v({GA4_MEASUREMENT_ID:'G-ABC123XYZ'}),[]);
 assert.equal(v({TURNSTILE_SITE_KEY:'bad key!'}).length,1);
 assert.equal(v({ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com'}).length,1,'AUD 必須一起填');
 assert.deepEqual(v({ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com',ACCESS_AUD:'a'.repeat(64)}),[]);
 assert.equal(errs({...base(),r2_buckets:[]}).length,1);assert.equal(errs({...base(),d1_databases:[{binding:'DB',database_name:'Bad_Name'}]}).length,1);
});

test('設定預檢：site.config.json 欄位格式與 ○○ 預留文字提醒',()=>{
 const ok={brand:'幸福里活動',communityName:'幸福里',brandMark:'幸',theme:'forest',themeColor:'',links:[{label:'LINE',url:''}],identities:['里民','其他']};
 assert.deepEqual(checkSite(ok),{errors:[],warnings:[]});
 assert.deepEqual(checkSite({...ok,brandMark:'👨‍👩‍👧'}).errors,[],'一個字形算一個字');
 assert.match(checkSite({...ok,brandMark:'幸福'}).errors[0],/1 個字/);
 assert.equal(checkSite({...ok,theme:'neon'}).errors.length,1);
 assert.equal(checkSite({...ok,themeColor:'blue'}).errors.length,1);
 assert.equal(checkSite({...ok,links:[{label:'站',url:'javascript:alert(1)'}]}).errors.length,1);
 assert.equal(checkSite({...ok,identities:['里民','里民']}).errors.length,1);
 assert.equal(checkSite({...ok,identities:[]}).errors.length,1);
 assert.equal(checkSite({...ok,brand:' '}).errors.length,1);
 assert.match(checkSite({...ok,communityName:'○○社區'}).warnings.join(),/○○/);
});
