import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {next,setAnswers,status,show,pending,siteConfigFrom,manifestFrom,wranglerFrom,missingFor} from '../scripts/setup-answers.mjs';
import {stages,questions} from '../scripts/setup-questions.mjs';
import {checkSite,checkWrangler,parseJSONC} from '../scripts/config-check.mjs';

const wranglerText=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
const site=JSON.parse(readFileSync(new URL('../site.config.json',import.meta.url),'utf8'));

test('開站問卷：題目 key 不重複，預設值都通過自己的格式檢查',()=>{
 assert.equal(new Set(questions.map(q=>q.key)).size,questions.length);
 for(const q of questions)if(q.default!==undefined&&q.validate){const d=typeof q.default==='function'?q.default({communityName:'幸福社宅'}):q.default;if(!(q.optional&&d===''))assert.equal(q.validate(d,{}),'',q.key);}
});

test('開站問卷：依關卡順序一次最多問 4 題；快速模式只問必要的 3 題（網站名稱有預設）',()=>{
 let a={};const first=next(a);assert.equal(first.stage,'content');assert.equal(first.questions.length,4);assert.equal(first.questions[0].key,'communityName');
 const quick=next(a,{quick:true});assert.deepEqual(quick.questions.map(q=>q.key),['communityName','brand']);
 a=setAnswers(a,{communityName:'幸福社宅',brand:null}).answers;
 assert.deepEqual(next(a,{quick:true}).questions.map(q=>q.key),['workerName','adminEmail']);
 assert.equal(next(a,{quick:true}).questions.find(q=>q.key==='adminEmail').private,true);
 a=setAnswers(a,{workerName:'happy-events',adminEmail:'organizer@example.org'}).answers;
 assert.equal(next(a,{quick:true}).stage,'login','快速模式問完內容與部署後，往後的關卡照常問');
 assert.equal(next(a,{stage:'content'}).questions[0].key,'englishBrand','逐項模式仍可回頭問沒答的題目');
});

test('開站問卷：格式不對當場拒絕，不存；null 代表用預設；條件題只在需要時問',()=>{
 const r=setAnswers({},{workerName:'Happy_Events',brandMark:'幸福',theme:'neon',links:[{label:'站',url:'http://x.org'}],identities:['a','a'],adminEmail:'nope',nonsense:1});
 assert.equal(r.saved.length,0);assert.equal(r.errors.length,7);
 assert.match(r.errors.join(),/workerName/);assert.match(r.errors.join(),/1 個字/);assert.match(r.errors.join(),/https/);assert.match(r.errors.join(),/重複/);
 assert.match(setAnswers({},{workerName:null}).errors[0],/沒有預設值/);
 let a=setAnswers({},{mailEnabled:false,ga4Enabled:true}).answers;
 const keys=pending(a,{stage:'optional'})[0].questions.map(q=>q.key);assert.ok(!keys.includes('mailFrom'));assert.ok(keys.includes('ga4Id'));
 a=setAnswers(a,{communityName:' 幸福社宅 '}).answers;assert.equal(a.communityName,'幸福社宅','前後空白去掉');
});

test('開站問卷：status 列出缺漏，show 遮住個資',()=>{
 const a=setAnswers({},{communityName:'幸福社宅',adminEmail:'organizer@example.org'}).answers;
 const s=status(a);assert.deepEqual(s.map(x=>x.stage),stages.map(x=>x.id));
 assert.deepEqual(s.find(x=>x.stage==='deploy').missing,['workerName']);assert.deepEqual(missingFor(a,'content'),[]);
 assert.equal(show(a).adminEmail,'（已填，只存在本機）');assert.doesNotMatch(JSON.stringify(show(a)),/organizer@/);
 assert.equal(show(a).brand,undefined,'沒回答的題目不列出');
});

test('開站問卷：套用後 site.config.json、webmanifest 與 wrangler.jsonc 通過設定預檢，沒有 ○○',()=>{
 const a=setAnswers({},{communityName:'幸福社宅',workerName:'happy-events',adminEmail:'organizer@example.org',theme:'forest',links:[{label:'LINE 社群',url:'https://line.me/ti/g2/x',note:'討論區'}],identities:['住戶','訪客']}).answers;
 const cfg=siteConfigFrom(site,a);
 assert.deepEqual(checkSite(cfg),{errors:[],warnings:[]});
 assert.equal(cfg.brand,'幸福社宅活動報名');assert.equal(cfg.brandMark,'幸');assert.equal(cfg.theme,'forest');assert.deepEqual(cfg.identities,['住戶','訪客']);
 assert.match(cfg.about.paragraphs[0],/幸福社宅/);assert.doesNotMatch(JSON.stringify(cfg),/○○|organizer@/,'個資不會寫進會提交的設定檔');
 assert.equal(manifestFrom({name:'x',short_name:'x',start_url:'/'},a).name,'幸福社宅活動報名');
 let w=wranglerFrom(wranglerText,a,'deploy');const j=parseJSONC(w);
 assert.equal(j.name,'happy-events');assert.equal(j.d1_databases[0].database_name,'happy-events');assert.equal(j.r2_buckets[0].bucket_name,'happy-events-photos');
 assert.equal(j.routes,undefined);assert.deepEqual(checkWrangler(j).errors,[]);
 assert.equal(w.split('\n').filter(l=>l.trim().startsWith('//')).length,wranglerText.split('\n').filter(l=>l.trim().startsWith('//')).length,'註解保留');
 w=wranglerFrom(w,{...a,customDomain:'events.example.org'},'deploy');let k=parseJSONC(w);
 assert.deepEqual(k.routes,[{pattern:'events.example.org',custom_domain:true}]);assert.equal(k.vars.SITE_URL,'https://events.example.org');
 assert.deepEqual(parseJSONC(wranglerFrom(w,{...a,customDomain:'new.example.org'},'deploy')).routes,[{pattern:'new.example.org',custom_domain:true}],'換網域不會多一組 routes');
 k=parseJSONC(wranglerFrom(w,{accessTeamDomain:'https://happy.cloudflareaccess.com/',accessAud:'a'.repeat(64)},'login'));assert.equal(k.vars.ACCESS_TEAM_DOMAIN,'happy.cloudflareaccess.com');assert.deepEqual(checkWrangler(k).errors,[]);
 k=parseJSONC(wranglerFrom(w,{mailEnabled:true,mailFrom:'幸福 <notify@example.org>',mailReplyTo:'team@example.org',ga4Enabled:true,ga4Id:'G-ABC123XYZ'},'optional'));
 assert.equal(k.vars.MAIL_MODE,'resend');assert.equal(k.vars.GA4_MEASUREMENT_ID,'G-ABC123XYZ');assert.deepEqual(checkWrangler(k).errors,[]);
 k=parseJSONC(wranglerFrom(w,{mailEnabled:false,ga4Enabled:false},'optional'));assert.equal(k.vars.MAIL_MODE,'disabled');assert.equal(k.vars.MAIL_FROM,'');
});
