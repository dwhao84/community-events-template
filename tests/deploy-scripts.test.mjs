import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {devVarsFrom,taipeiDate,sampleSpec,SAMPLE_ID} from '../scripts/setup-local.mjs';
import {setVarText,versionId,workersDevURL} from '../scripts/deploy-lib.mjs';
import {r2Disabled,bucketNames,workerMissing} from '../scripts/deploy-bootstrap.mjs';
import {siteKeyValid,widgetFor} from '../scripts/setup-turnstile.mjs';
import {parseJSONC} from '../scripts/config-check.mjs';

test('本機設定：.dev.vars 由範例產生，秘密換成隨機值並開啟本機三行',()=>{
 const example=readFileSync(new URL('../.dev.vars.example',import.meta.url),'utf8');let n=0;
 const out=devVarsFrom(example,()=>`rand${++n}xxxxxxxxxxxxxxxx`);
 assert.match(out,/^RATE_SALT=rand\d/m);assert.match(out,/^FEEDBACK_TOKEN_SECRET=rand\d/m);assert.match(out,/^LOCAL_ADMIN_TOKEN=rand\d/m);
 assert.match(out,/^APP_ENV=development$/m);assert.match(out,/^SITE_URL=http:\/\/localhost:8787$/m);
 assert.doesNotMatch(out,/replace-with/);assert.match(out,/^# TURNSTILE_SITE_KEY=/m,'Turnstile 測試鍵維持註解');
 assert.equal(new Set(out.match(/rand\d+/g)).size,3,'每個秘密各自不同');
});

test('本機示範活動：場次在台灣時間的未來日期，可由 event-sql 規則產生',()=>{
 const now=Date.parse('2026-12-31T17:00:00Z');// 台灣已是 2027-01-01 01:00
 assert.equal(taipeiDate(0,now),'2027-01-01');assert.equal(taipeiDate(14,now),'2027-01-15');
 const s=sampleSpec(now);assert.equal(s.id,SAMPLE_ID);assert.ok(s.sessions.every(x=>x.date>taipeiDate(0,now)));
});

test('部署腳本：wrangler.jsonc 單一變數替換保留註解與其他內容',()=>{
 const text=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
 const out=setVarText(text,'SITE_URL','https://a-b.c.workers.dev');
 assert.equal(parseJSONC(out).vars.SITE_URL,'https://a-b.c.workers.dev');
 assert.equal(out.split('\n').filter(l=>l.trim().startsWith('//')).length,text.split('\n').filter(l=>l.trim().startsWith('//')).length);
 assert.equal(parseJSONC(setVarText(out,'SITE_URL','https://x.org')).vars.SITE_URL,'https://x.org');
 assert.throws(()=>setVarText(text,'NOPE','x'),/找不到/);
});

test('部署腳本：解析 wrangler 輸出',()=>{
 const deploy='Uploaded sunshine-events\nDeployed sunshine-events triggers\n  https://sunshine-events.abc-123.workers.dev\n  schedule: */5 * * * *\nCurrent Version ID: 0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
 assert.equal(workersDevURL(deploy),'https://sunshine-events.abc-123.workers.dev');assert.equal(versionId(deploy),'0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
 assert.equal(workersDevURL('no url'),'');
 assert.ok(r2Disabled('Please enable R2 through the Cloudflare Dashboard. [code: 10042]'));assert.ok(!r2Disabled('Authentication error [code: 10000]'));
 assert.deepEqual(bucketNames('Listing buckets...\nname:           other-photos\ncreation_date:  2026-01-01\n\nname:           community-events-photos\n'),['other-photos','community-events-photos']);
 assert.ok(workerMissing('This Worker does not exist on your account. [code: 10007]'));assert.ok(!workerMissing('Authentication error [code: 10000]'));
});

test('Turnstile：Site Key 格式拒絕測試鍵與 Secret 樣式；依網域找既有 widget',()=>{
 assert.ok(siteKeyValid('0x4AAAAAAABkMYinukE8nzY'));assert.ok(!siteKeyValid('1x00000000000000000000AA'));assert.ok(!siteKeyValid('bad key'));assert.ok(!siteKeyValid(''));
 assert.equal(widgetFor([{sitekey:'a',domains:['x.org']},{sitekey:'b',domains:['y.workers.dev']}],'y.workers.dev').sitekey,'b');
 assert.equal(widgetFor([],'y.org'),undefined);
});
