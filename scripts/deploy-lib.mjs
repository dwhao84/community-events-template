// Shared helpers for deploy-bootstrap.mjs and setup-turnstile.mjs. Secrets only pass through stdin; nothing here prints them.
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseJSONC} from './config-check.mjs';

export const root=fileURLToPath(new URL('..',import.meta.url));
export const wranglerPath=join(root,'wrangler.jsonc');
export const say=m=>console.log(m),warn=m=>console.warn('⚠ '+m);
export const die=(m,code=1)=>{console.error('✖ '+m);process.exit(code);};
export const readWrangler=()=>parseJSONC(readFileSync(wranglerPath,'utf8'));
// Replace one "vars" value in wrangler.jsonc without touching comments or layout.
export function setVarText(text,key,value){
 const re=new RegExp(`("${key}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
 if(!re.test(text))throw Error(`wrangler.jsonc 找不到 ${key}`);
 return text.replace(re,(_,head)=>head+JSON.stringify(value));
}
export const setVar=(key,value)=>writeFileSync(wranglerPath,setVarText(readFileSync(wranglerPath,'utf8'),key,value));
export function ensureWrangler(){
 const bin=join(root,'node_modules','.bin','wrangler');
 if(!existsSync(bin))die('尚未安裝套件：先執行 npm install（或 npm run setup:local）。');
 return bin;
}
// Runs wrangler; CI=true keeps it from stopping at (Y/n) prompts. tee=true also streams output to the terminal.
export function wrangler(args,{input,tee=false,inherit=false}={}){
 const bin=ensureWrangler();
 return new Promise(resolve=>{
  const child=spawn(bin,args,{cwd:root,env:{...process.env,CI:'true'},stdio:inherit?'inherit':['pipe','pipe','pipe']});
  let out='',err='';
  if(!inherit){child.stdout.on('data',d=>{out+=d;if(tee)process.stdout.write(d);});child.stderr.on('data',d=>{err+=d;if(tee)process.stderr.write(d);});child.stdin.end(input??'');}
  child.on('close',code=>resolve({code,out,err,all:out+err}));
 });
}
export async function whoami(){
 const r=await wrangler(['whoami','--json']);
 if(r.code!==0)return null;
 try{return JSON.parse(r.out);}catch{return null;}
}
// Single Cloudflare account, or the one CLOUDFLARE_ACCOUNT_ID names.
export async function account(){
 const me=await whoami();
 if(!me||me.loggedIn===false)die('尚未登入 Cloudflare：執行 npx wrangler login，在瀏覽器按允許後再重試。');
 const list=me.accounts||[];
 if(process.env.CLOUDFLARE_ACCOUNT_ID){const a=list.find(x=>x.id===process.env.CLOUDFLARE_ACCOUNT_ID);return a||{id:process.env.CLOUDFLARE_ACCOUNT_ID,name:'(CLOUDFLARE_ACCOUNT_ID)'};}
 if(list.length===1)return list[0];
 if(!list.length)die('Cloudflare 登入資訊沒有帳號，請重新執行 npx wrangler login。');
 die(`這個登入有 ${list.length} 個 Cloudflare 帳號，請指定要用哪一個：\n${list.map(a=>`  ${a.name}：CLOUDFLARE_ACCOUNT_ID=${a.id}`).join('\n')}\n例如：CLOUDFLARE_ACCOUNT_ID=<id> npm run deploy:first`);
}
export async function secretNames(name){
 const r=await wrangler(['secret','list','--name',name,'--format','json']);
 if(r.code!==0)return null;
 try{return JSON.parse(r.out).map(s=>s.name);}catch{return null;}
}
export const putSecrets=obj=>wrangler(['secret','bulk'],{input:JSON.stringify(obj)});
export const versionId=text=>(text.match(/Current Version ID:\s*([0-9a-f-]{36})/i)||[])[1]||'';
export const workersDevURL=text=>(text.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i)||[])[0]||'';
// Ask once. Non-interactive runs (AI assistants) must pass --yes after the person agreed in the conversation.
export async function confirm(question,flags){
 if(flags.has('--yes'))return true;
 if(!process.stdin.isTTY)die('需要確認：請先讓主辦方看過上面的清單並同意，再加上 --yes 重新執行。',2);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 const a=(await rl.question(`${question}（輸入 y 同意）：`)).trim().toLowerCase();rl.close();
 return ['y','yes','同意'].includes(a);
}
export async function ask(question){
 if(!process.stdin.isTTY)return '';
 const rl=createInterface({input:process.stdin,output:process.stdout});
 const a=(await rl.question(question)).trim();rl.close();return a;
}
// Public checks after deploy: page status and security headers (no registrations, no mail).
export async function checkSite(url,{tries=10,wait=3000,expectTurnstile=false}={}){
 let last=null;
 for(let i=0;i<tries;i++){
  try{const r=await fetch(url,{redirect:'manual'});last=r;if(r.status===200)break;}catch(e){last={status:0,headers:new Headers(),error:e.message};}
  await new Promise(r=>setTimeout(r,wait));
 }
 const h=last?.headers||new Headers(),csp=h.get('content-security-policy')||'';
 const checks=[['首頁回應 200',last?.status===200,String(last?.status??'無回應')],['Content-Security-Policy',!!csp,csp?'有':'缺少'],['Strict-Transport-Security',!!h.get('strict-transport-security'),h.get('strict-transport-security')||'缺少'],['X-Content-Type-Options: nosniff',h.get('x-content-type-options')==='nosniff',h.get('x-content-type-options')||'缺少']];
 if(expectTurnstile)checks.push(['CSP 允許 challenges.cloudflare.com',csp.includes('https://challenges.cloudflare.com'),csp.includes('https://challenges.cloudflare.com')?'有':'缺少']);
 for(const [label,ok,detail] of checks)say(`  ${ok?'✔':'✖'} ${label}${ok?'':`（${detail}）`}`);
 return checks.every(c=>c[1]);
}
export function log(lines){
 const dir=join(root,'.local');mkdirSync(dir,{recursive:true});
 appendFileSync(join(dir,'deploy-log.md'),`\n## ${new Date().toISOString()}\n\n${lines.map(l=>`- ${l}`).join('\n')}\n`);
}
export const runCheck=()=>{try{execFileSync(process.execPath,[join(root,'scripts','check.mjs')],{cwd:root,stdio:'inherit'});return true;}catch{return false;}};
