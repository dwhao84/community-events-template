#!/usr/bin/env node
// 開站問卷的答案：AI 助理用它決定下一步要問什麼、存答案、把答案寫進設定檔。答案只存在 .local/setup-answers.json（不提交）。
// 用法（npm run setup -- <指令>）：
//   next [--stage <id>] [--quick]   下一批要問的題目（JSON，一次最多 4 題）；全部問完回 {"done":true}
//   set '<JSON>'                    存答案，例如 '{"communityName":"幸福社宅","theme":"forest"}'；null 代表「用預設」
//   status                          每一關已回答／還缺哪些
//   show [--stage <id>]             目前的答案（個資會遮住）
//   apply [--stage <id>]            寫進 site.config.json、public/site.webmanifest、wrangler.jsonc，再跑設定預檢
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stages,questions,byKey,valueOf} from './setup-questions.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
export const answersPath=join(root,'.local','setup-answers.json');
export const readAnswers=(path=answersPath)=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return {};}};
export const writeAnswers=(a,path=answersPath)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify(a,null,1)+'\n',{mode:0o600});};
const applies=(q,a)=>!q.when||q.when(a);
// Questions still to ask: not answered yet and relevant; quick mode asks only quick questions in the stages that have them.
export function pending(a,{stage,quick=false}={}){
 return stages.filter(s=>!stage||s.id===stage).map(s=>{
  const hasQuick=s.questions.some(q=>q.quick);
  return {...s,questions:s.questions.filter(q=>!(q.key in a)&&applies(q,a)&&(!quick||!hasQuick||q.quick))};
 }).filter(s=>s.questions.length);
}
export function next(a,opts={},limit=4){
 const s=pending(a,opts)[0];if(!s)return {done:true};
 return {stage:s.id,stage_number:s.stage,title:s.title,...(s.after?{after:s.after}:{}),questions:s.questions.slice(0,limit).map(q=>({key:q.key,ask:q.ask,example:q.example,...(q.default!==undefined?{default:valueOf(q,{...a,[q.key]:undefined})}:{}),...(q.optional?{optional:true}:{}),...(q.private?{private:true}:{})})),remaining:s.questions.length};
}
// Validates and merges answers; null means "use the default". Returns {answers, saved, errors}.
export function setAnswers(a,input){
 const out={...a},saved=[],errors=[];
 for(const [k,v] of Object.entries(input||{})){
  const q=byKey[k];if(!q){errors.push(`${k}：沒有這一題`);continue;}
  if(v===null){if(q.default===undefined&&!q.optional){errors.push(`${k}：這一題沒有預設值，請直接回答`);continue;}out[k]=null;saved.push(k);continue;}
  const value=typeof v==='string'?v.trim():Array.isArray(v)?v.map(x=>typeof x==='string'?x.trim():x):v;
  const err=q.validate?q.validate(value,out):'';if(err){errors.push(`${k}：${err}`);continue;}
  out[k]=value;saved.push(k);
 }
 return {answers:out,saved,errors};
}
export function status(a){
 return stages.map(s=>{const rel=s.questions.filter(q=>applies(q,a));const answered=rel.filter(q=>q.key in a).map(q=>q.key);
  const missing=rel.filter(q=>!(q.key in a)&&q.default===undefined&&!q.optional).map(q=>q.key);
  return {stage:s.id,stage_number:s.stage,title:s.title,answered:answered.length,total:rel.length,missing,unanswered:rel.filter(q=>!(q.key in a)).map(q=>q.key)};});
}
export const show=(a,stage)=>Object.fromEntries(questions.filter(q=>(!stage||q.stageId===stage)&&q.key in a).map(q=>[q.key,q.private?'（已填，只存在本機）':valueOf(q,a)]));

// ---------- apply ----------
const v=(k,a)=>valueOf(byKey[k],a);
export function siteConfigFrom(cfg,a){
 return {...cfg,communityName:v('communityName',a),brand:v('brand',a),englishBrand:v('englishBrand',a),brandMark:v('brandMark',a),tagline:v('tagline',a),description:v('description',a),theme:v('theme',a),heroTitle:v('heroTitle',a),heroText:v('heroText',a),
  links:v('links',a).map(l=>({label:l.label.trim(),note:typeof l.note==='string'?l.note.trim():'',url:l.url.trim()})),identities:v('identities',a),
  about:{...(cfg.about||{}),title:v('aboutTitle',a),paragraphs:v('aboutParagraphs',a),contact:v('aboutContact',a)},emailSignoff:v('emailSignoff',a),feedbackOrganizer:v('feedbackOrganizer',a)};
}
export function manifestFrom(m,a){const brand=v('brand',a);return {...m,name:brand,short_name:[...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(brand)].slice(0,12).map(x=>x.segment).join('')};}
const setString=(text,key,value)=>{const re=new RegExp(`("${key}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);if(!re.test(text))throw Error(`wrangler.jsonc 找不到 ${key}`);return text.replace(re,(_,h)=>h+JSON.stringify(value));};
// Edits wrangler.jsonc as text so comments and layout survive.
export function wranglerFrom(text,a,stage){
 let t=text;
 if(stage==='deploy'){
  const name=v('workerName',a);
  t=setString(t,'name',name);t=setString(t,'database_name',name);t=setString(t,'bucket_name',`${name}-photos`);
  const domain=v('customDomain',a);
  t=t.replace(/\n\s*"routes"\s*:\s*\[[^\]]*\],?/,'');
  if(domain){t=t.replace(/("workers_dev"\s*:\s*(?:true|false),)/,`$1\n  "routes": [{"pattern": ${JSON.stringify(domain)}, "custom_domain": true}],`);t=setString(t,'SITE_URL',`https://${domain}`);}
 }
 if(stage==='login'&&a.accessTeamDomain&&a.accessAud){t=setString(t,'ACCESS_TEAM_DOMAIN',a.accessTeamDomain.replace(/^https:\/\//,'').replace(/\/$/,''));t=setString(t,'ACCESS_AUD',a.accessAud);}
 if(stage==='optional'){
  const mail=v('mailEnabled',a)===true&&a.mailFrom&&a.mailReplyTo;
  t=setString(t,'MAIL_MODE',mail?'resend':'disabled');t=setString(t,'MAIL_FROM',mail?a.mailFrom:'');t=setString(t,'MAIL_REPLY_TO',mail?a.mailReplyTo:'');
  t=setString(t,'GA4_MEASUREMENT_ID',v('ga4Enabled',a)===true&&a.ga4Id?a.ga4Id:'');
 }
 return t;
}
const writable=['content','deploy','login','optional'];
export function missingFor(a,stage){const s=stages.find(x=>x.id===stage);return s.questions.filter(q=>applies(q,a)&&!(q.key in a)&&q.default===undefined&&!q.optional).map(q=>q.key);}
function apply(a,stage){
 const targets=stage?[stage]:writable.filter(id=>id!=='login'||(a.accessTeamDomain&&a.accessAud));
 const done=[];
 for(const id of targets){
  if(!writable.includes(id))throw Error(`「${id}」這一關的答案不寫進設定檔（${id==='protect'?'由 npm run setup:turnstile 使用':'是給 AI 起草後台內容用的'}）`);
  const miss=missingFor(a,id);if(miss.length)throw Error(`「${stages.find(s=>s.id===id).title}」還缺：${miss.join('、')}（先用 npm run setup -- next --stage ${id} 問完）`);
  if(id==='content'){
   const sp=join(root,'site.config.json');writeFileSync(sp,JSON.stringify(siteConfigFrom(JSON.parse(readFileSync(sp,'utf8')),a),null,2)+'\n');
   const mp=join(root,'public','site.webmanifest');writeFileSync(mp,JSON.stringify(manifestFrom(JSON.parse(readFileSync(mp,'utf8')),a),null,2)+'\n');
   done.push('site.config.json','public/site.webmanifest');
  }else{const wp=join(root,'wrangler.jsonc');writeFileSync(wp,wranglerFrom(readFileSync(wp,'utf8'),a,id));done.push(`wrangler.jsonc（${id}）`);}
 }
 return [...new Set(done)];
}

function main(){
 const [cmd,...rest]=process.argv.slice(2);
 const flag=name=>{const i=rest.indexOf(name);return i>=0?(rest[i+1]&&!rest[i+1].startsWith('--')?rest[i+1]:true):undefined;};
 const stage=flag('--stage');if(stage&&stage!==true&&!stages.some(s=>s.id===stage)){console.error(`沒有這一關：${stage}（可用：${stages.map(s=>s.id).join('、')}）`);process.exit(1);}
 const a=readAnswers(),print=x=>console.log(JSON.stringify(x,null,1));
 if(cmd==='next')return print(next(a,{stage:stage===true?undefined:stage,quick:!!flag('--quick')}));
 if(cmd==='set'){
  let input;try{input=JSON.parse(rest[0]||'');}catch{console.error('請用 JSON 傳入答案，例如：npm run setup -- set \'{"communityName":"幸福社宅"}\'');process.exit(1);}
  const r=setAnswers(a,input);if(r.saved.length)writeAnswers(r.answers);
  print({saved:r.saved,errors:r.errors});if(r.errors.length)process.exit(1);return;
 }
 if(cmd==='status')return print(status(a));
 if(cmd==='show')return print(show(a,stage===true?undefined:stage));
 if(cmd==='apply'){
  let done;try{done=apply(a,stage===true?undefined:stage);}catch(e){console.error('✖ '+e.message);process.exit(1);}
  console.log('已寫入：'+done.join('、'));
  try{execFileSync(process.execPath,[join(root,'scripts','config-check.mjs')],{stdio:'inherit'});}catch{process.exit(1);}
  return;
 }
 console.error('指令：next | set \'<JSON>\' | status | show | apply（可加 --stage <id>、--quick）');process.exit(1);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main();
