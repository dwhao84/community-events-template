// Analytics is optional: every public entry point fails closed and never blocks registration.
const KEY='dn_analytics_consent',TTL=180*86400000;
const EVENTS=new Set(['page_view','section_view','cta_click','event_view','registration_open','registration_start','registration_submit','registration_success','registration_error','photo_view','mascot_open','mascot_action','outbound_click']);
const PARAMS=new Set(['event_id','activity_session_id','entry_point','section_name','action','destination','registration_status','participant_count','error_type']);
let config,enabled=false,started=false,observer,memoryChoice,pendingReload=false;
const seen=new Set(),timers=new Map();
export function sanitizeParams(params={}){return Object.fromEntries(Object.entries(params).filter(([k,v])=>PARAMS.has(k)&&(k==='participant_count'?Number.isInteger(v)&&v>0:typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v))));}
export function safeLocation(href){const u=new URL(href);return u.origin+u.pathname;}
export function consentValue(storage,now=Date.now()){try{storage??=localStorage;const v=JSON.parse(storage.getItem(KEY));return v&&['granted','denied'].includes(v.value)&&v.expires>now&&v.expires<=now+TTL?v.value:null;}catch{return null;}}
export function errorType(error){return error.details?.reload?'form_changed':error.status===429?'rate_limited':error.status===409?'conflict':error.status===400||error.status===422?'validation':error.status>=500?'server':'network';}
export function track(name,params={}){try{if(enabled&&EVENTS.has(name))window.gtag('event',name,sanitizeParams(params));}catch{/* optional */}}
function clearTimers(){for(const timer of timers.values())clearTimeout(timer);timers.clear();}
export function observeContent(){try{
 observer?.disconnect();clearTimers();if(!enabled||!window.IntersectionObserver)return;
 observer=new IntersectionObserver(entries=>{for(const item of entries){const el=item.target,key=el.dataset.eventId?'event:'+el.dataset.eventId:'section:'+el.id;
 if(item.intersectionRatio<0.5||document.hidden){clearTimeout(timers.get(el));timers.delete(el);continue;}
 if(seen.has(key)||timers.has(el))continue;
 timers.set(el,setTimeout(()=>{timers.delete(el);if(!enabled||document.hidden||!el.isConnected)return;seen.add(key);track(el.dataset.eventId?'event_view':'section_view',el.dataset.eventId?{event_id:el.dataset.eventId}:{section_name:el.id});observer.unobserve(el);},1000));
 }},{threshold:[0,0.5]});
 document.querySelectorAll('#activities,.event-card[data-event-id]').forEach(el=>observer.observe(el));
 }catch{/* optional */}}
function activate(){
 if(!config?.measurement_id||!/^G-[A-Z0-9]+$/.test(config.measurement_id)||location.hostname!==config.host)return;
 if(started){if(!enabled){enabled=true;window['ga-disable-'+config.measurement_id]=false;window.gtag('consent','update',{analytics_storage:'granted'});observeContent();}return;}
 started=true;enabled=true;window['ga-disable-'+config.measurement_id]=false;
 window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};
 window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 window.gtag('js',new Date());
 const campaign={};for(const [key,target]of Object.entries({utm_source:'campaign_source',utm_medium:'campaign_medium',utm_campaign:'campaign_name',utm_id:'campaign_id',utm_term:'campaign_term',utm_content:'campaign_content'})){const value=new URL(location.href).searchParams.get(key);if(value&&/^[a-zA-Z0-9_-]{1,100}$/.test(value))campaign[target]=value;}
 window.gtag('config',config.measurement_id,{send_page_view:false,page_location:safeLocation(location.href),page_referrer:document.referrer?safeLocation(document.referrer):'',page_title:document.title,allow_google_signals:false,allow_ad_personalization_signals:false,...campaign});
 const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+config.measurement_id;script.onerror=()=>{started=false;enabled=false;window['ga-disable-'+config.measurement_id]=true;script.remove?.();observer?.disconnect();clearTimers();window.dataLayer.length=0;};document.head.append(script);
 track('page_view');observeContent();
}
function clearCookies(){try{for(const part of document.cookie.split(';')){const name=part.split('=')[0].trim();if(!/^_ga(?:_|$)/.test(name))continue;for(const domain of ['',location.hostname,'.'+location.hostname])document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax'+(domain?'; Domain='+domain:'');}}catch{/* cookies unavailable */}}
function reloadAfterWithdrawal(){const event=new Event('analytics-before-reload',{cancelable:true});pendingReload=!window.dispatchEvent(event);if(!pendingReload)location.reload();}
function choose(value){memoryChoice=value;try{localStorage.setItem(KEY,JSON.stringify({value,expires:Date.now()+TTL}));}catch{/* choice applies to this page */}
 document.querySelector('#analytics-preferences').hidden=true;
 if(value==='granted'){activate();return;}
 enabled=false;if(started)window['ga-disable-'+config.measurement_id]=true;observer?.disconnect();clearTimers();clearCookies();
 if(started){window.dataLayer.length=0;reloadAfterWithdrawal();}
}
export async function initAnalytics(){try{
 window.addEventListener('analytics-reload-ready',()=>{if(pendingReload&&!enabled){pendingReload=false;location.reload();}});
 const panel=document.querySelector('#analytics-preferences');
 document.querySelector('#analytics-settings').addEventListener('click',()=>{panel.hidden=false;panel.querySelector('button').focus();});
 panel.querySelector('[data-consent=granted]').addEventListener('click',()=>choose('granted'));
 panel.querySelector('[data-consent=denied]').addEventListener('click',()=>choose('denied'));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimers();else observeContent();});
 window.addEventListener('storage',event=>{if(event.key!==KEY&&event.key!==null)return;if(consentValue()==='granted')activate();else{enabled=false;if(started)window['ga-disable-'+config.measurement_id]=true;observer?.disconnect();clearTimers();clearCookies();if(started){window.dataLayer.length=0;reloadAfterWithdrawal();}}});
 document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;
 if(link.matches('nav a[href^="#"],.hero-actions a,.ai-hero-footer a'))track('cta_click',{entry_point:link.closest('nav')?'navigation':link.closest('.ai-hero-footer')?'hero_ai':'hero_safety',section_name:link.hash.slice(1)});
 if(link.matches('.mascot-link')){const destination=link.classList.contains('line')?'line':'dingdong';track('outbound_click',{destination,entry_point:'mascot'});track('mascot_action',{action:destination});}
 });
 const response=await fetch('/analytics-config',{credentials:'omit'});if(!response.ok)return;config=await response.json();
 const choice=memoryChoice||consentValue();if(choice==='granted')activate();else if(!choice)panel.hidden=false;
 }catch{/* analytics failures cannot affect the site */}}
