import {HttpError,fail,jsonBody,assertOrigin} from './lib.js';
import {authenticate} from './auth.js';
import {publicData,publicForm,register,adminAPI} from './api.js';
import {media} from './photos.js';
import {webhook,processJobs} from './mail.js';
import {feedbackPublic} from './feedback.js';
import {publicSite} from './site.js';
import {calendarFile,publicAbout,publicBlocks,siteImageMedia} from './admin-tools.js';
import {siteAppearanceCSS,siteIcon} from './admin-tools.js';
import {turnstileSiteKey,turnstileOrigin} from './turnstile.js';
const iconPaths=['/favicon.ico','/favicon.svg','/favicon-192.png','/favicon-512.png','/apple-touch-icon.png'];
const headers={
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 // Start with one day and no subdomains; raise max-age once production HTTPS is confirmed stable.
 'Strict-Transport-Security':'max-age=86400'
};
// The home page (registration form) may load GA4 after consent and, when configured, the Turnstile widget; other pages keep 'self'.
export function homeCSP(env){const ts=turnstileSiteKey(env)?' '+turnstileOrigin:'';return headers['Content-Security-Policy'].replace("script-src 'self'",`script-src 'self' https://www.googletagmanager.com${ts}`).replace("connect-src 'self'","connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com")+(ts?`; frame-src${ts}`:'');}
function response(data,status=200){return data instanceof Response?data:Response.json(data,{status});}
// Feedback links carry a one-time token: never leak it via Referer, caches or search indexes.
function private_(r){r.headers.set('Referrer-Policy','no-referrer');r.headers.set('Cache-Control','no-store');r.headers.set('X-Robots-Tag','noindex');return r;}
function secure(r,api=false){const out=new Response(r.body,r);for(const [k,v]of Object.entries(headers))out.headers.set(k,v);if(api)out.headers.set('Cache-Control','no-store');return out;}
export async function handle(req,env) {
 const url=new URL(req.url);
 // Development keeps HTTP so LAN devices can test `wrangler dev --ip 0.0.0.0`; loopback stays exempt as a second guard.
 if(url.protocol==='http:'&&env.APP_ENV!=='development'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
  url.protocol='https:';
  return secure(Response.redirect(url.href,308));
 }
 const p=url.pathname.split('/').filter(Boolean);const method=req.method;
 try{
  if(url.pathname==='/api/webhooks/resend'&&method==='POST')return secure(response(await webhook(req,env)),true);
  // GA4 only in production, and only on the configured SITE_URL host when one is set.
  if(url.pathname==='/analytics-config'&&method==='GET'){let host=url.hostname;try{if(env.SITE_URL)host=new URL(env.SITE_URL).hostname;}catch{host='';}const on=env.APP_ENV==='production'&&url.hostname===host&&!['localhost','127.0.0.1','[::1]'].includes(host)&&/^G-[A-Z0-9]+$/.test(env.GA4_MEASUREMENT_ID||'');return secure(Response.json({measurement_id:on?env.GA4_MEASUREMENT_ID:null,host:on?host:null},{headers:{'Cache-Control':'no-store'}}));}
  // Site colors are generated from the saved palette (or a preview palette for the admin picker); CSP stays 'self'.
  if(url.pathname==='/theme.css'&&method==='GET')return secure(await siteAppearanceCSS(req,env,url));
  // An uploaded site icon replaces every favicon path; without one the static defaults in public/ are served.
  if(method==='GET'&&iconPaths.includes(url.pathname)){const icon=await siteIcon(env,url.pathname);if(icon)return secure(icon);}
  if(url.pathname==='/site-config.json'&&method==='GET')return secure(Response.json(publicSite(),{headers:{'Cache-Control':'public, max-age=300'}}));
  if(p[0]==='api'){
   assertOrigin(req);
   const rawPhoto=p[1]==='admin'&&method==='POST'&&((p[2]==='photos'&&(!p[3]||p[4]==='thumbnail'))||(p[2]==='site-images'&&p.length===3));
   const hasBody=['POST','PUT','PATCH'].includes(method)&&!rawPhoto;
   if(p[1]==='admin'){
    const admin=await authenticate(req,env);
    // Up to 100 attendees with bounded vector signatures; only authenticated check-in writes get this limit.
    const signatureWrite=p[2]==='checkins'&&((method==='PUT'&&p[4]==='attendees'&&p.length===5)||(method==='POST'&&p[3]==='onsite'&&p.length===4));
    const b=hasBody?await jsonBody(req,signatureWrite?2100000:65536):{};
    if(!['GET','POST','PATCH','PUT'].includes(method))fail(405,'不支援此方法');
    // Reject writes on read-only endpoints and unexpected extra path segments.
    // Administrative links are only for signed-in admins; the data lives outside public/ so static assets can never serve it.
    const readOnly=['me','audit'];if(readOnly.includes(p[2])&&method!=='GET')fail(405,'不支援此方法');
    const result=await adminAPI(req,env,admin,url,p.slice(2),b);return secure(response(result),true);
   }
   const b=hasBody?await jsonBody(req):{};
   if(url.pathname==='/api/public'&&method==='GET')return secure(response(await publicData(env)),true);
   if(url.pathname==='/api/about'&&method==='GET')return secure(response(await publicAbout(env.DB)),true);
   if(url.pathname==='/api/page'&&method==='GET')return secure(response(await publicBlocks(env.DB,'page')),true);
   if(p[1]==='sessions'&&p[3]==='calendar.ics'&&p.length===4&&method==='GET')return secure(await calendarFile(env,p[2],url.origin),true);
   if(p[1]==='sessions'&&p[3]==='form'&&method==='GET')return secure(response(await publicForm(env,p[2])),true);
   if(p[1]==='sessions'&&p[3]==='registrations'&&method==='POST')return secure(response(await register(req,env,p[2],b),201),true);
   if(p[1]==='feedback'&&((p.length===3&&method==='GET')||(p.length===4&&p[3]==='submit'&&method==='POST')))return private_(secure(response(await feedbackPublic(req,env,p[2],p[3],b)),true));
   fail(404,'找不到 API');
  }
  // Site images (banners, About page) are public; event photos keep their publish checks.
  if(p[0]==='media'&&p.length===2&&method==='GET'){const siteImage=/^[0-9a-f-]{36}$/.test(p[1])?await siteImageMedia(env,p[1]):null;return secure(siteImage||await media(req,env,p[1]));}
  if(p[0]==='admin'&&env.APP_ENV!=='development')await authenticate(req,env);
  // /admin/feedback/... deep links are client-side routes of the admin app.
  if(p[0]==='admin'&&p[1]==='feedback'&&method==='GET')return secure(await env.ASSETS.fetch(new Request(new URL('/admin/',url),{headers:req.headers})));
  // /feedback/:slug and /feedback/:slug/success share one static page; analytics is never loaded there.
  if((p[0]==='feedback'||p[0]==='feedback.html')&&p.length<=3&&method==='GET')return private_(secure(await env.ASSETS.fetch(new Request(new URL('/feedback',url),{headers:req.headers}))));
  // The organizer-defined page used to live at /safety.html; keep old links working.
  if(method==='GET'&&url.pathname==='/safety.html')return secure(Response.redirect(new URL('/page.html',url),301));
  if(method==='GET'&&url.pathname==='/admin/*'&&url.searchParams.get('__cf_access_message')==='logged_out')return secure(Response.redirect(new URL('/admin/',url),302));
  const asset=secure(await env.ASSETS.fetch(req));
  if(url.pathname==='/'||url.pathname==='/index.html')asset.headers.set('Content-Security-Policy',homeCSP(env));
  return asset;
 }catch(error){
  let status=error.status||500,message=error.message;
  if(!(error instanceof HttpError)){
   const str=String(error.message);if(/capacity_exceeded/.test(str)){status=409;message='剩餘名額不足，請重新整理名單';}
   else if(/seat_limit_exceeded/.test(str)){status=400;message='超過每筆報名人數上限';}
   else if(/session_or_form_changed|session_closed/.test(str)){status=409;message='場次或表單已變更，請重新載入';}
   else if(/UNIQUE constraint/.test(str)){status=409;message='資料已存在或剛剛已提交，請重新整理';}
   else if(/published_form_immutable/.test(str)){status=409;message='已發布版本不可覆寫';}
   else if(/feedback_[a-z_]+/.test(str)){status=409;message='課程回饋狀態已變更，請重新整理';}
   else {message='服務暫時無法處理，請稍後再試';console.error('request_failed',url.pathname,error.name);}
  }
  const out=secure(response({error:message,...(error.details?{details:error.details}:{})},status),true);
  return url.pathname.startsWith('/api/feedback/')?private_(out):out;
 }
}
export default {fetch:handle,scheduled:async(_event,env,ctx)=>{ctx.waitUntil(processJobs(env));}};
