#!/usr/bin/env node
// 第一次部署（用 Wrangler 指令部署的路線；用 Deploy to Cloudflare 按鈕的不需要這支）。
// 一次確認後連續完成：部署 Worker 並自動建立 D1／R2 → 套用遠端 migration → 寫入秘密 → 回填 SITE_URL 再部署 → 檢查正式站標頭。
// 用法：
//   npm run deploy:first -- --plan                       只做檢查並列出將執行的項目，不做任何變更
//   npm run deploy:first -- --admin-email you@example.org  執行（終端機會要求輸入 y 確認；AI 助理在取得同意後加 --yes）
// 沒有 --admin-email 時讀取 MY-COMMUNITY.md 的「第一位管理員的 Email」。秘密只經 stdin 傳給 wrangler，不會印出。
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root,say,warn,die,readWrangler,setVar,wrangler,account,secretNames,putSecrets,versionId,workersDevURL,confirm,checkSite,log,runCheck} from './deploy-lib.mjs';

export const r2Disabled=text=>/10042|enable R2|R2.*not.*enabled|purchase R2/i.test(text);
export const bucketNames=text=>[...text.matchAll(/^name:\s*(\S+)/gm)].map(m=>m[1]);
export const workerMissing=text=>/10007|does not exist|not found|could not find/i.test(text);
export function adminEmailFromMyCommunity(md){
 const m=md.match(/第一位管理員的 Email[^：:\n]*[：:][ \t]*([^\s]+@[^\s]+)/);return m?m[1].replace(/[<>`]/g,''):'';
}
const arg=(flags,name)=>{const a=process.argv.slice(2),i=a.indexOf(name);if(i>=0&&a[i+1]&&!a[i+1].startsWith('--'))return a[i+1];const eq=a.find(x=>x.startsWith(name+'='));return eq?eq.slice(name.length+1):'';};

async function main(){
 const flags=new Set(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>x.split('=')[0]));
 const plan=flags.has('--plan');
 const w=readWrangler(),name=w.name,dbName=w.d1_databases?.find(d=>d.binding==='DB')?.database_name,bucket=w.r2_buckets?.find(b=>b.binding==='PHOTOS')?.bucket_name;
 let email=arg(flags,'--admin-email')||process.env.ADMIN_BOOTSTRAP_EMAIL||'';
 if(!email&&existsSync(join(root,'MY-COMMUNITY.md')))email=adminEmailFromMyCommunity(readFileSync(join(root,'MY-COMMUNITY.md'),'utf8'));
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))die(`管理員 Email 格式錯誤：${email}`);

 say('1/7 程式與設定檢查（npm run check）…');
 if(!runCheck())die('檢查沒有通過，請先修正再部署。');
 say('\n2/7 Cloudflare 帳號與既有資源…');
 const acct=await account();say(`  帳號：${acct.name}`);
 const dep=await wrangler(['deployments','list','--name',name,'--json']);
 if(dep.code===0)die(`帳號裡已經有名為「${name}」的 Worker。為了不蓋到既有網站，這支腳本只做第一次部署。\n  如果那就是這個社區的網站，之後更新請用 npm run deploy；\n  如果是別的網站，請在 wrangler.jsonc 換一個 name（D1、R2 名稱也一起換）。`);
 if(!workerMissing(dep.all))die('無法確認 Worker 是否存在：\n'+dep.all.slice(-600));
 const d1=await wrangler(['d1','list','--json']);
 if(d1.code!==0)die('無法列出 D1 資料庫：\n'+d1.all.slice(-600));
 const dbExists=(JSON.parse(d1.out||'[]')).some(d=>d.name===dbName);
 const r2=await wrangler(['r2','bucket','list']);
 if(r2.code!==0&&r2Disabled(r2.all))die(`這個 Cloudflare 帳號還沒啟用 R2（用來存活動照片）。\n  1. 打開 https://dash.cloudflare.com/?to=/:account/r2/overview\n  2. 依畫面啟用 R2（免費額度內不收費，但可能需要綁定付款方式）\n  3. 回來重新執行：npm run deploy:first`);
 if(r2.code!==0)die('無法列出 R2 bucket：\n'+r2.all.slice(-600));
 const bucketExists=bucketNames(r2.out).includes(bucket);
 if((dbExists||bucketExists)&&!flags.has('--reuse-existing'))die(`帳號裡已經有同名的${dbExists?` D1「${dbName}」`:''}${bucketExists?` R2「${bucket}」`:''}，但沒有同名 Worker。\n  如果是別的專案在用，請在 wrangler.jsonc 換名稱；\n  如果確定是這個網站上次部署到一半留下的，加 --reuse-existing 重新執行。`);
 say(`  Worker「${name}」：尚未存在 ✔\n  D1「${dbName}」：${dbExists?'沿用上次留下的':'將自動建立'}\n  R2「${bucket}」：${bucketExists?'沿用上次留下的':'將自動建立'}`);

 const siteURL=w.vars?.SITE_URL||'';
 say(`\n這次會依序執行（全部在帳號「${acct.name}」）：
  a. wrangler deploy：上傳網站，${dbExists?'':'建立 D1 資料庫、'}${bucketExists?'':'建立 R2 照片空間、'}取得 workers.dev 網址
  b. 套用遠端資料庫 migration（建立資料表，不含任何活動或報名資料）
  c. 寫入秘密：RATE_SALT、FEEDBACK_TOKEN_SECRET（隨機產生，已存在就不改）${email?`、ADMIN_BOOTSTRAP_EMAIL=${email}`:''}
  d. ${siteURL?`SITE_URL 已設定為 ${siteURL}，不更動`:'把 workers.dev 網址回填到 wrangler.jsonc 的 SITE_URL，再部署一次'}
  e. 檢查正式站首頁 200 與 CSP、HSTS、X-Content-Type-Options 標頭（不會建立測試報名或寄信）`);
 if(!email)warn('沒有指定第一位管理員 Email（--admin-email），ADMIN_BOOTSTRAP_EMAIL 之後要另外設定，否則無法登入後台。');
 if(plan){say('\n（--plan：只列出項目，沒有做任何變更）');return;}
 if(!await confirm('\n確定要執行以上項目嗎？',flags))die('已取消，沒有做任何變更。');

 const record=[`Worker：${name}`,'部署前正式版本：無（第一次部署）'];
 say('\n3/7 部署 Worker…');
 const first=await wrangler(['deploy'],{tee:true});
 if(first.code!==0){if(r2Disabled(first.all))die('R2 尚未啟用：到 https://dash.cloudflare.com/?to=/:account/r2/overview 啟用後，加 --reuse-existing 重新執行。');die('部署失敗；上面是 wrangler 的訊息。修正後加 --reuse-existing 重新執行（D1／R2 可能已建立）。');}
 const devURL=workersDevURL(first.all);let ver=versionId(first.all);
 record.push(`第一次部署版本：${ver||'（未解析到）'}`,`workers.dev 網址：${devURL||'（未解析到）'}`);
 say('\n4/7 套用遠端資料庫 migration…');
 const mig=await wrangler(['d1','migrations','apply','DB','--remote'],{tee:true});
 if(mig.code!==0)die('遠端 migration 失敗。網站已部署但資料表可能不完整，請把上面的訊息貼給 AI 助理；不要重複部署。');
 say('\n5/7 寫入秘密（不會顯示內容）…');
 const have=await secretNames(name)||[];
 const secrets={};
 for(const k of ['RATE_SALT','FEEDBACK_TOKEN_SECRET'])if(!have.includes(k))secrets[k]=randomBytes(32).toString('base64url');
 if(email)secrets.ADMIN_BOOTSTRAP_EMAIL=email;
 if(Object.keys(secrets).length){const s=await putSecrets(secrets);if(s.code!==0)die('寫入秘密失敗：\n'+s.err.replace(/[A-Za-z0-9_-]{40,}/g,'***').slice(-600));}
 say(`  已設定：${Object.keys(secrets).join('、')||'（全部已存在，未更動）'}`);
 record.push(`秘密：${[...new Set([...have,...Object.keys(secrets)])].filter(k=>['RATE_SALT','FEEDBACK_TOKEN_SECRET','ADMIN_BOOTSTRAP_EMAIL'].includes(k)).join('、')}（值未記錄）`);
 let url=siteURL;
 say('\n6/7 SITE_URL…');
 if(!siteURL){
  if(!devURL)die('沒有從部署訊息找到 workers.dev 網址；請到 Cloudflare 儀表板的 Workers & Pages 找網址，手動填入 wrangler.jsonc 的 SITE_URL（結尾不加 /）後執行 npm run deploy。');
  setVar('SITE_URL',devURL);url=devURL;say(`  已把 SITE_URL 設為 ${devURL}，重新部署…`);
  const again=await wrangler(['deploy'],{tee:true});
  if(again.code!==0)die('第二次部署失敗；SITE_URL 已寫入 wrangler.jsonc，修正後執行 npm run deploy。');
  ver=versionId(again.all)||ver;record.push(`回填 SITE_URL 後版本：${ver||'（未解析到）'}`);
 }else say(`  沿用 ${siteURL}`);
 say(`\n7/7 檢查正式站 ${url} …`);
 const ok=await checkSite(url+'/');
 record.push(`公開網址：${url}`,`標頭檢查：${ok?'通過':'未全部通過'}`);
 log(record);
 say(`\n${ok?'✔ 第一次部署完成':'⚠ 已部署，但有檢查項目沒通過（見上方）'}。紀錄已寫入 .local/deploy-log.md。`);
 say(`  網址：${url}\n  版本：${ver||'（請在儀表板確認）'}\n接下來：\n  1. 設定後台登入（Cloudflare Access，見 docs/manual-handoffs.md C1）\n  2. 開啟報名防護：npm run setup:turnstile\n  3. 若 wrangler.jsonc 有變更（SITE_URL），記得 commit`);
 if(!ok)process.exit(1);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main();
