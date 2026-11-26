import {fail} from './lib.js';
// Cloudflare Turnstile on public registration: blocks scripted seat-squatting and receipt mail sent to strangers.
// On when TURNSTILE_SITE_KEY (public var) and TURNSTILE_SECRET_KEY (secret) are both set; half a config fails closed.
export const turnstileOrigin='https://challenges.cloudflare.com';
export const turnstileSiteKey=env=>/^[0-9A-Za-z_-]{10,100}$/.test(env.TURNSTILE_SITE_KEY||'')?env.TURNSTILE_SITE_KEY:null;
export function turnstileEnabled(env){
 const site=!!turnstileSiteKey(env),secret=!!env.TURNSTILE_SECRET_KEY;
 if(site!==secret){console.error('turnstile_misconfigured');fail(503,'報名防護設定不完整，請聯絡主辦方');}
 return site;
}
const retry={turnstile:'請重新完成真人驗證後再送出'};
export async function verifyTurnstile(req,env,token,fetcher=fetch){
 if(!turnstileEnabled(env))return;
 if(typeof token!=='string'||!token||token.length>2048)fail(400,'請先完成「確認您是真人」驗證',retry);
 const form=new FormData();form.append('secret',env.TURNSTILE_SECRET_KEY);form.append('response',token);
 const ip=req.headers.get('cf-connecting-ip');if(ip)form.append('remoteip',ip);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let r;
 try{const res=await fetcher(`${turnstileOrigin}/turnstile/v0/siteverify`,{method:'POST',body:form,signal:controller.signal});if(!res.ok)throw Error();r=await res.json();}
 catch{console.error('turnstile_unavailable');fail(503,'真人驗證服務暫時無法使用，請稍後再試');}
 finally{clearTimeout(timer);}
 // Production also pins the widget action and this site's hostname; Cloudflare's test keys only pass outside production.
 const strict=env.APP_ENV==='production';
 if(r?.success!==true||strict&&(r.action!=='register'||r.hostname!==new URL(req.url).hostname))fail(400,'真人驗證未通過或已逾時，請重新驗證',retry);
}
