#!/usr/bin/env node
// 報名防護（Cloudflare Turnstile）半自動設定。網站必須已部署且 wrangler.jsonc 已有 SITE_URL。
// 1. 先試 Cloudflare API 建立 Managed widget（需要 Turnstile 寫入權限：CLOUDFLARE_API_TOKEN，或 wrangler 登入本身就有）。
//    Site Key 寫進 wrangler.jsonc，Secret Key 直接經 stdin 寫入 TURNSTILE_SECRET_KEY，不印出。
// 2. 權限不足就改成人工交接：印出儀表板連結與要填的網域，人只要提供 Site Key、在終端機輸入 Secret Key。
// 兩把鑰匙都到位後重新部署，並檢查 CSP 允許 challenges.cloudflare.com。
// 用法：npm run setup:turnstile [-- --plan] [-- --yes] [-- --site-key 0x4AAAA…] [-- --manual]
import {fileURLToPath} from 'node:url';
import {say,warn,die,readWrangler,setVar,wrangler,account,secretNames,versionId,confirm,ask,checkSite,log} from './deploy-lib.mjs';

const API='https://api.cloudflare.com/client/v4';
export const siteKeyValid=k=>/^[0-9A-Za-z_-]{10,100}$/.test(k||'')&&!/^[12]x0{10,}/.test(k);
export const widgetFor=(list,host)=>(list||[]).find(w=>(w.domains||[]).includes(host));
const arg=name=>{const a=process.argv.slice(2),i=a.indexOf(name);if(i>=0&&a[i+1]&&!a[i+1].startsWith('--'))return a[i+1];const eq=a.find(x=>x.startsWith(name+'='));return eq?eq.slice(name.length+1):'';};

async function token(){
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 const r=await wrangler(['auth','token','--json']);
 if(r.code!==0)return '';
 try{const j=JSON.parse(r.out);return j.token||j.value||j.credentials?.token||'';}catch{return '';}
}
// Returns {sitekey,secret} or null when the credentials cannot manage Turnstile.
async function viaAPI(acct,host,name){
 const t=await token();if(!t)return null;
 const h={authorization:`Bearer ${t}`,'content-type':'application/json'};
 const call=async(path,init={})=>{try{const r=await fetch(`${API}/accounts/${acct.id}/challenges/widgets${path}`,{...init,headers:h});const j=await r.json().catch(()=>({}));return {ok:r.ok&&j.success!==false,status:r.status,j};}catch{return {ok:false,status:0,j:{}};}};
 const list=await call('?per_page=50');
 if(!list.ok){say(`  目前的 Cloudflare 憑證不能管理 Turnstile（HTTP ${list.status}），改用人工步驟。`);return null;}
 const found=widgetFor(list.j.result,host);
 if(found){const one=await call('/'+found.sitekey);if(one.ok&&one.j.result?.secret){say(`  沿用帳號裡已有的 widget「${found.name}」。`);return {sitekey:found.sitekey,secret:one.j.result.secret};}return null;}
 const made=await call('',{method:'POST',body:JSON.stringify({name:`${name} 報名防護`.slice(0,254),domains:[host],mode:'managed'})});
 if(!made.ok||!made.j.result?.sitekey||!made.j.result?.secret){say(`  無法透過 API 建立 widget（HTTP ${made.status}），改用人工步驟。`);return null;}
 say('  已透過 API 建立 Managed widget。');
 return {sitekey:made.j.result.sitekey,secret:made.j.result.secret};
}

async function main(){
 const flags=new Set(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>x.split('=')[0]));
 const w=readWrangler(),name=w.name,site=w.vars?.SITE_URL||'';
 if(!site)die('wrangler.jsonc 還沒有 SITE_URL；請先完成第一次部署（npm run deploy:first）。');
 const host=new URL(site).hostname,current=w.vars?.TURNSTILE_SITE_KEY||'';
 const acct=await account();
 const have=await secretNames(name);
 if(!have)die(`找不到 Worker「${name}」或無法讀取秘密清單；請先完成第一次部署。`);
 const secretSet=have.includes('TURNSTILE_SECRET_KEY');
 if(current&&secretSet){say('Site Key 與 Secret Key 都已設定，只做線上檢查：');const ok=await checkSite(site+'/',{tries:3,expectTurnstile:true});process.exit(ok?0:1);}
 say(`報名防護設定：Worker「${name}」，網域 ${host}，帳號「${acct.name}」
這次會：
  a. 取得 Turnstile Site Key 與 Secret Key（先試 Cloudflare API，不行就請你從儀表板複製）
  b. 把 Secret Key 寫入秘密 TURNSTILE_SECRET_KEY（不會顯示）
  c. 把 Site Key 寫進 wrangler.jsonc 並重新部署（兩把鑰匙之間會有幾秒報名回 503，屬正常）
  d. 檢查正式站 CSP 允許 https://challenges.cloudflare.com`);
 if(flags.has('--plan')){say('\n（--plan：只列出項目，沒有做任何變更）');return;}
 if(!await confirm('\n確定要執行嗎？',flags))die('已取消，沒有做任何變更。');

 let keys=flags.has('--manual')||arg('--site-key')?null:await viaAPI(acct,host,name);
 if(keys){
  const s=await wrangler(['secret','put','TURNSTILE_SECRET_KEY','--name',name],{input:keys.secret});
  if(s.code!==0)die('寫入 TURNSTILE_SECRET_KEY 失敗：\n'+s.err.slice(-400));
 }else{
  let siteKey=arg('--site-key')||current;
  if(!siteKey){
   say(`\n請到 Cloudflare 儀表板建立 widget：
  1. 打開 https://dash.cloudflare.com/?to=/:account/turnstile ，按「Add widget」
  2. Widget name：${name} 報名防護
  3. Hostname：${host}
  4. Widget Mode：Managed，按「Create」
  5. 畫面會顯示 Site Key 和 Secret Key（先不要關掉）`);
   siteKey=await ask('\n請貼上 Site Key：');
   if(!siteKey)die(`拿到 Site Key 後執行：npm run setup:turnstile -- --site-key <Site Key> --yes\n（Site Key 是公開值，可以直接貼給 AI 助理；Secret Key 不要貼）`,2);
  }
  if(!siteKeyValid(siteKey))die('Site Key 格式不對（應為 0x4AAAA… 這種格式，不是 Secret Key，也不能是測試用的 1x0000… 鑰匙）。');
  keys={sitekey:siteKey};
  if(!secretSet){
   if(!process.stdin.isTTY)die(`接著請「你自己」在終端機執行下面這行，貼上 Secret Key 後按 Enter（輸入時不會顯示）：\n  npx wrangler secret put TURNSTILE_SECRET_KEY\n完成後再執行：npm run setup:turnstile -- --site-key ${siteKey} --yes`,2);
   say('\n接著輸入 Secret Key（輸入時不會顯示）：');
   const s=await wrangler(['secret','put','TURNSTILE_SECRET_KEY','--name',name],{inherit:true});
   if(s.code!==0)die('寫入 TURNSTILE_SECRET_KEY 失敗，請重試。');
  }
 }
 if(keys.sitekey!==current)setVar('TURNSTILE_SITE_KEY',keys.sitekey);
 say('\n重新部署…');
 const dep=await wrangler(['deploy'],{tee:true});
 if(dep.code!==0)die('部署失敗。Site Key 已寫入 wrangler.jsonc、Secret 已設定；修正後執行 npm run deploy（在那之前報名會回 503）。');
 say(`\n檢查 ${site} …`);
 const ok=await checkSite(site+'/',{expectTurnstile:true});
 log([`Turnstile：Site Key 已寫入 wrangler.jsonc（${host}），TURNSTILE_SECRET_KEY 已設定（值未記錄）`,`部署版本：${versionId(dep.all)||'（未解析到）'}`,`CSP 與標頭檢查：${ok?'通過':'未全部通過'}`]);
 say(ok?'\n✔ 報名防護已開啟。請用手機打開報名表，確認看得到驗證框（不要真的送出測試報名）；記得 commit wrangler.jsonc。':'\n⚠ 已部署，但檢查沒有全部通過（見上方）。');
 if(!ok)process.exit(1);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main();
