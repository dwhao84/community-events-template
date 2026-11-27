#!/usr/bin/env node
// 本機一鍵預覽：檢查環境 → 產生 .dev.vars（已存在就不動）→ 套用本機 D1 migration → 選擇性匯入示範活動 → 啟動 wrangler dev。
// 只寫本機 .dev.vars 與 .wrangler/，不連任何遠端資源。
// 用法：npm run setup:local [-- --with-sample] [-- --no-dev]
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
export const SAMPLE_ID='sample-local-demo';
export const randomToken=(bytes=32)=>randomBytes(bytes).toString('base64url');
// .dev.vars.example → .dev.vars：秘密換成隨機值，取消註解本機那三行；Turnstile 測試鍵與 Resend 維持原樣。
export function devVarsFrom(example,rand=randomToken){
 return example
  .replace(/^RATE_SALT=.*$/m,()=>`RATE_SALT=${rand()}`)
  .replace(/^FEEDBACK_TOKEN_SECRET=.*$/m,()=>`FEEDBACK_TOKEN_SECRET=${rand()}`)
  .replace(/^# APP_ENV=development$/m,'APP_ENV=development')
  .replace(/^# SITE_URL=(http:\/\/localhost:\d+)$/m,'SITE_URL=$1')
  .replace(/^# LOCAL_ADMIN_TOKEN=.*$/m,()=>`LOCAL_ADMIN_TOKEN=${rand()}`);
}
// 台灣日期 +N 天（YYYY-MM-DD），讓示範場次永遠在未來。
export const taipeiDate=(days,now=Date.now())=>new Date(now+8*3600e3+days*86400e3).toISOString().slice(0,10);
export const sampleSpec=(now=Date.now())=>({id:SAMPLE_ID,title:'【示範】社區手作體驗',description:'這是本機預覽用的示範活動，只存在你的電腦（.wrangler/），不會出現在正式網站。可以在後台修改或刪除。',notes:'示範活動：請勿當作真實活動宣傳。',contact:'示範聯絡方式（請在後台修改）',
 sessions:[{date:taipeiDate(14,now),start:'14:00',end:'15:30',location:'社區活動中心',capacity:30,fee_type:'free',max_seats_per_registration:4,registration_open:true},{date:taipeiDate(21,now),start:'10:00',end:'12:00',location:'社區活動中心',capacity:20,fee_type:'paid',fee_amount:100,fee_note:'含材料費',max_seats_per_registration:2,registration_open:true}]});

const say=m=>console.log(m),warn=m=>console.warn('⚠ '+m),die=m=>{console.error('✖ '+m);process.exit(1);};
const has=(cmd,args=['--version'])=>{try{execFileSync(cmd,args,{stdio:'ignore'});return true;}catch{return false;}};
const wranglerBin=join(root,'node_modules','.bin','wrangler');
// CI=true 讓 wrangler 不停在 (Y/n) 確認；這裡只用於 --local。
const wrangler=(args,opts={})=>execFileSync(wranglerBin,args,{cwd:root,env:{...process.env,CI:'true'},stdio:opts.capture?['ignore','pipe','pipe']:'inherit',encoding:'utf8'});

async function main(){
 const flags=new Set(process.argv.slice(2));
 if(flags.has('--help')){say('用法：npm run setup:local [-- --with-sample] [-- --no-dev]');return;}
 // 1. 環境
 const [maj,min]=process.versions.node.split('.').map(Number);
 if(maj<22||maj===22&&min<13)die(`需要 Node.js 22.13 以上（目前 ${process.version}）。請到 https://nodejs.org 安裝 LTS 版。`);
 if(!has('sqlite3'))warn('找不到 sqlite3：本機預覽不需要，但 npm run check 會用到。macOS 內建；Windows 可用 winget install SQLite.SQLite。');
 if(!existsSync(wranglerBin)){
  const pm=existsSync(join(root,'pnpm-lock.yaml'))&&has('pnpm')?'pnpm':'npm';
  say(`尚未安裝套件，執行 ${pm} install …`);
  try{execFileSync(pm,['install'],{cwd:root,stdio:'inherit'});}catch{die(`${pm} install 失敗，請檢查網路後重試。`);}
 }
 // 2. 設定預檢
 try{execFileSync(process.execPath,[join(root,'scripts','config-check.mjs')],{stdio:'inherit'});}catch{die('請先修正上面列出的設定錯誤。');}
 // 3. .dev.vars
 const vars=join(root,'.dev.vars');
 if(existsSync(vars)){
  const cur=readFileSync(vars,'utf8');say('.dev.vars 已存在，不覆寫。');
  if(!/^APP_ENV=development$/m.test(cur)||!/^LOCAL_ADMIN_TOKEN=\S{16,}/m.test(cur))warn('.dev.vars 沒有啟用 APP_ENV=development 或 LOCAL_ADMIN_TOKEN，本機後台會無法登入；請參考 .dev.vars.example 最後幾行。');
 }else{
  writeFileSync(vars,devVarsFrom(readFileSync(join(root,'.dev.vars.example'),'utf8')),{mode:0o600});
  say('已產生 .dev.vars（本機專用的隨機值；此檔不會被 git 提交）。');
 }
 // 4. 本機資料庫
 say('套用本機資料庫 migration（.wrangler/，不影響正式網站）…');
 try{wrangler(['d1','migrations','apply','DB','--local']);}catch{die('本機 migration 失敗，請把上面的錯誤訊息貼給 AI 助理。');}
 // 5. 示範活動
 if(flags.has('--with-sample'))addSample();
 // 6. 啟動
 const port=(readFileSync(vars,'utf8').match(/^SITE_URL=http:\/\/localhost:(\d+)$/m)||[])[1]||'8787';
 say(`\n首頁：http://localhost:${port}\n後台：http://localhost:${port}/admin/  （登入權杖是 .dev.vars 裡的 LOCAL_ADMIN_TOKEN）`);
 if(flags.has('--no-dev')){say('已略過啟動；之後執行 npm run dev。');return;}
 say('啟動 wrangler dev（按 Ctrl+C 結束）…\n');
 const child=spawn(wranglerBin,['dev'],{cwd:root,stdio:'inherit'});
 child.on('exit',code=>process.exit(code??0));
}
function addSample(){
 const out=wrangler(['d1','execute','DB','--local','--json','--command',`SELECT id FROM events WHERE id='${SAMPLE_ID}'`],{capture:true});
 if(/"id":\s*"sample-local-demo"/.test(out)){say('示範活動已存在，略過。');return;}
 const temp=mkdtempSync(join(tmpdir(),'community-sample-'));
 try{
  const spec=join(temp,'spec.json'),sqlFile=join(temp,'sample.sql');
  writeFileSync(spec,JSON.stringify(sampleSpec()));
  const sql=execFileSync(process.execPath,[join(root,'scripts','event-sql.mjs'),'add',spec,'--print'],{cwd:root,encoding:'utf8'});
  // 本機預覽才開啟營運設定，讓示範場次可以試填報名；正式網站仍須由主辦方在後台確認個資告知後開啟。
  writeFileSync(sqlFile,sql+"UPDATE settings SET value='true' WHERE key='operating_ready';\n");
  try{wrangler(['d1','execute','DB','--local','--file',sqlFile],{capture:true});}catch(e){die('匯入示範活動失敗：'+String(e.stderr||e.message).slice(-500));}
  say('已匯入示範活動（兩個未來場次，只在本機）。本機營運設定已開啟，可試填報名。');
 }finally{rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main();
