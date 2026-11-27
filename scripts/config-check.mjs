// Preflight for wrangler.jsonc and site.config.json: catches format mistakes before tests, local preview or deploy.
// Usage: node scripts/config-check.mjs  (exit 1 on errors; warnings such as leftover ○○ placeholders do not fail)
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {themeIds} from '../src/themes.js';

const root=new URL('..',import.meta.url);
// JSONC → JSON: drops // and /* */ comments outside strings, then trailing commas.
export function parseJSONC(text){
 let out='',i=0,str=false;
 while(i<text.length){const c=text[i],n=text[i+1];
  if(str){out+=c;if(c==='\\'){out+=n??'';i+=2;continue;}if(c==='"')str=false;i++;continue;}
  if(c==='"'){str=true;out+=c;i++;continue;}
  if(c==='/'&&n==='/'){while(i<text.length&&text[i]!=='\n')i++;continue;}
  if(c==='/'&&n==='*'){i=text.indexOf('*/',i+2);if(i<0)throw Error('未結束的 /* 註解');i+=2;continue;}
  out+=c;i++;}
 return JSON.parse(out.replace(/,(\s*[}\]])/g,'$1'));
}
const isStr=v=>typeof v==='string';
const chars=v=>[...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(v)].length;
export function checkWrangler(w){
 const errors=[],warnings=[],v=w?.vars||{};
 if(!isStr(w?.name)||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(w.name))errors.push('wrangler.jsonc name 只能用小寫英文、數字與 -，不可用 - 開頭或結尾，最長 63 字（例：sunshine-events）');
 if(v.APP_ENV!=='production')errors.push('wrangler.jsonc vars.APP_ENV 必須是 "production"；本機開發改在 .dev.vars 設 APP_ENV=development');
 const url=v.SITE_URL??'';
 if(!isStr(url))errors.push('wrangler.jsonc vars.SITE_URL 必須是文字');
 else if(url==='')warnings.push('SITE_URL 尚未填寫：第一次部署後把 workers.dev 網址填回來再部署一次（npm run deploy:first 會自動處理）');
 else if(url.endsWith('/'))errors.push(`SITE_URL 結尾不要加 /（目前：${url}）`);
 else if(!/^https:\/\/[a-z0-9.-]+$/i.test(url))errors.push(`SITE_URL 必須是 https:// 開頭的網址，不含路徑或埠號（目前：${url}）`);
 if(!['disabled','resend','mock'].includes(v.MAIL_MODE??'disabled'))errors.push('MAIL_MODE 只能是 disabled、resend 或 mock');
 if(v.MAIL_MODE==='mock')errors.push('正式設定不可使用 MAIL_MODE=mock；mock 只在 .dev.vars 本機使用');
 if(v.MAIL_MODE==='resend'&&!v.MAIL_FROM)errors.push('MAIL_MODE=resend 時必須填 MAIL_FROM');
 for(const k of ['MAIL_FROM','MAIL_REPLY_TO'])if(v[k]&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v[k])&&!/<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(v[k]))errors.push(`${k} 不是有效的 Email`);
 if(v.MAIL_CC&&!String(v.MAIL_CC).split(',').every(s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())))errors.push('MAIL_CC 須為以逗號分隔的 Email');
 if(v.GA4_MEASUREMENT_ID&&!/^G-[A-Z0-9]{4,20}$/.test(v.GA4_MEASUREMENT_ID))errors.push('GA4_MEASUREMENT_ID 格式應為 G-XXXXXXXXXX');
 if(v.TURNSTILE_SITE_KEY&&!/^[0-9A-Za-z_-]{10,100}$/.test(v.TURNSTILE_SITE_KEY))errors.push('TURNSTILE_SITE_KEY 格式錯誤（應為 Cloudflare 提供的 Site Key，例如 0x4AAAA…）；Secret Key 不可放在這裡');
 if(!v.TURNSTILE_SITE_KEY)warnings.push('TURNSTILE_SITE_KEY 尚未設定：上線前強烈建議開啟報名防護（npm run setup:turnstile）');
 if(!!v.ACCESS_TEAM_DOMAIN!==!!v.ACCESS_AUD)errors.push('ACCESS_TEAM_DOMAIN 與 ACCESS_AUD 必須一起填寫');
 if(v.ACCESS_TEAM_DOMAIN&&!/^(https:\/\/)?[a-z0-9-]+\.cloudflareaccess\.com\/?$/i.test(v.ACCESS_TEAM_DOMAIN))errors.push('ACCESS_TEAM_DOMAIN 格式應為 <團隊名稱>.cloudflareaccess.com');
 if(v.ACCESS_AUD&&!/^[0-9a-f]{64}$/i.test(v.ACCESS_AUD))errors.push('ACCESS_AUD 應為 64 個十六進位字元（Access 應用程式的 Application Audience (AUD) Tag）');
 for(const k of ['MAX_PHOTO_BYTES','MAX_PHOTO_DIMENSION'])if(v[k]!==undefined&&!/^[1-9]\d*$/.test(String(v[k])))errors.push(`${k} 必須是正整數`);
 const db=w?.d1_databases?.find(d=>d.binding==='DB'),r2=w?.r2_buckets?.find(b=>b.binding==='PHOTOS');
 if(!db)errors.push('wrangler.jsonc 缺少 binding 為 DB 的 d1_databases');
 else if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(db.database_name||''))errors.push('D1 database_name 只能用小寫英文、數字與 -');
 if(!r2)errors.push('wrangler.jsonc 缺少 binding 為 PHOTOS 的 r2_buckets');
 else if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r2.bucket_name||''))errors.push('R2 bucket_name 只能用小寫英文、數字與 -，長度 3–63 字');
 return {errors,warnings};
}
export function checkSite(s){
 const errors=[],warnings=[];
 if(!s||typeof s!=='object'||Array.isArray(s))return {errors:['site.config.json 必須是物件'],warnings};
 for(const k of ['brand','communityName'])if(!isStr(s[k])||!s[k].trim())errors.push(`site.config.json ${k} 不可空白`);
 for(const k of ['englishBrand','brandMark','tagline','description','heroTitle','heroText','emailSignoff','feedbackOrganizer','theme','themeColor'])if(s[k]!==undefined&&!isStr(s[k]))errors.push(`site.config.json ${k} 必須是文字`);
 if(isStr(s.brandMark)&&s.brandMark.trim()&&chars(s.brandMark.trim())!==1)errors.push(`brandMark 只能是 1 個字（目前：「${s.brandMark}」）`);
 if(isStr(s.brand)&&chars(s.brand)>30)warnings.push('brand 超過 30 字，手機導覽列可能換行');
 if(isStr(s.theme)&&s.theme&&!themeIds.includes(s.theme))errors.push(`theme 必須是 ${themeIds.join('、')} 之一（目前：${s.theme}）`);
 if(isStr(s.themeColor)&&s.themeColor&&!/^#[0-9a-f]{6}$/i.test(s.themeColor))errors.push('themeColor 必須是 #RRGGBB 或留空');
 if(s.links!==undefined){if(!Array.isArray(s.links))errors.push('links 必須是陣列');else s.links.forEach((l,i)=>{if(!l||!isStr(l.label)||!isStr(l.url))errors.push(`links[${i}] 須有 label 與 url 文字`);else if(l.url&&!/^https?:\/\/\S+$/.test(l.url))errors.push(`links[${i}].url 必須是 http(s):// 開頭，或留空不顯示`);});}
 if(s.identities!==undefined){if(!Array.isArray(s.identities)||!s.identities.length)errors.push('identities 必須是至少一個選項的陣列');else{if(s.identities.some(x=>!isStr(x)||!x.trim()||x.length>50))errors.push('identities 每個選項須為 1–50 字的文字');if(new Set(s.identities.map(x=>String(x).trim())).size!==s.identities.length)errors.push('identities 有重複選項');}}
 if(s.about!==undefined&&(typeof s.about!=='object'||Array.isArray(s.about)||s.about&&s.about.paragraphs!==undefined&&!Array.isArray(s.about.paragraphs)))errors.push('about 須為物件，paragraphs 須為陣列');
 const placeholders=Object.entries(s).filter(([,v])=>JSON.stringify(v).includes('○○')).map(([k])=>k);
 if(placeholders.length)warnings.push(`site.config.json 還有 ○○ 預留文字：${placeholders.join('、')}`);
 return {errors,warnings};
}
export function configCheck(dir=root){
 const read=(name,parse)=>{try{return [parse(readFileSync(new URL(name,dir),'utf8')),null];}catch(e){return [null,`${name} 無法讀取或格式錯誤：${e.message}`];}};
 const [w,we]=read('wrangler.jsonc',parseJSONC),[s,se]=read('site.config.json',JSON.parse);
 const a=w?checkWrangler(w):{errors:[we],warnings:[]},b=s?checkSite(s):{errors:[se],warnings:[]};
 return {errors:[...a.errors,...b.errors],warnings:[...a.warnings,...b.warnings],wrangler:w,site:s};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {errors,warnings}=configCheck();
 for(const w of warnings)console.warn('⚠ '+w);
 for(const e of errors)console.error('✖ '+e);
 if(errors.length){console.error(`設定檢查失敗：${errors.length} 項錯誤`);process.exit(1);}
 console.log('wrangler.jsonc 與 site.config.json 格式檢查：ok');
}
