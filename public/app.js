import "./site.js";
import {signaturePad} from './signature.js';
import {eventNotesMarkup} from './schedule.js';
import {initAnalytics,track,observeContent,errorType} from './analytics.js';
initAnalytics();
import {esc,api,fieldMarkup,readAnswers,toast,statusLabel,dateLabel,calendarMenu,feeBadge} from './shared.js';
let namePad=null;
let registrationContext={},formStarted=false,submitting=false,formRequest=0;
const trackedSubmissions=new Set();
let data,activeSession,activeForm,submissionId,publicDataState='loading';
const dialog=document.querySelector('#registration-dialog'),content=document.querySelector('#registration-content');
for(const b of document.querySelectorAll('.close-dialog'))b.addEventListener('click',()=>b.closest('dialog').close());
const hero=document.querySelector('.campaign-hero'),heroBox=document.querySelector('#hero-slides'),heroDotsBox=document.querySelector('.hero-dots'),heroControls=document.querySelector('.hero-carousel-controls'),heroToggle=document.querySelector('.hero-play-toggle'),heroAnnouncement=document.querySelector('.hero-announcement'),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let heroSlides=[...heroBox.children],heroDots=[],heroIndex=0,heroTimer,userPaused=reducedMotion.matches,heroPointerX;
function updateHeroToggle(){heroToggle.setAttribute('aria-pressed',String(userPaused));heroToggle.firstElementChild.textContent=userPaused?'▶':'Ⅱ';heroToggle.lastElementChild.textContent=userPaused?'播放輪播':'暫停輪播';}
function scheduleHero(){clearTimeout(heroTimer);if(heroSlides.length>1&&!userPaused&&!reducedMotion.matches&&!document.hidden)heroTimer=setTimeout(()=>showHero(heroIndex+1),7000);}
function showHero(index,announce=false){if(!heroSlides.length)return;heroIndex=(index+heroSlides.length)%heroSlides.length;heroSlides.forEach((slide,i)=>{const active=i===heroIndex;slide.classList.toggle('is-active',active);slide.setAttribute('aria-hidden',String(!active));slide.inert=!active;});heroDots.forEach((dot,i)=>{const active=i===heroIndex;dot.classList.toggle('is-active',active);dot.setAttribute('aria-current',String(active));});if(announce)heroAnnouncement.textContent=`已顯示${heroSlides[heroIndex].dataset.heroTitle}`;scheduleHero();}
function selectHero(index){if(heroSlides.length>1)showHero(index,true);}
document.querySelector('.hero-prev').addEventListener('click',()=>selectHero(heroIndex-1));document.querySelector('.hero-next').addEventListener('click',()=>selectHero(heroIndex+1));heroDotsBox.addEventListener('click',event=>{const dot=event.target.closest('[data-hero-target]');if(dot)selectHero(Number(dot.dataset.heroTarget));});
heroToggle.addEventListener('click',()=>{userPaused=!userPaused;updateHeroToggle();scheduleHero();heroAnnouncement.textContent=userPaused?'主視覺輪播已暫停':'主視覺輪播已播放';});
hero.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();selectHero(heroIndex-1);}if(event.key==='ArrowRight'){event.preventDefault();selectHero(heroIndex+1);}});
hero.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse')heroPointerX=event.clientX;});hero.addEventListener('pointerup',event=>{if(heroPointerX===undefined)return;const distance=event.clientX-heroPointerX;heroPointerX=undefined;if(Math.abs(distance)>50)selectHero(heroIndex+(distance<0?1:-1));});hero.addEventListener('pointercancel',()=>{heroPointerX=undefined;});
document.addEventListener('visibilitychange',scheduleHero);reducedMotion.addEventListener?.('change',event=>{userPaused=event.matches;updateHeroToggle();scheduleHero();});updateHeroToggle();showHero(0);
// Banners come from the admin "首頁 Banner" page; without any, the neutral text hero above stays.
// Images keep their natural ratio (posters often carry text), so width/height only reserve space.
let bannersRendered=false;
function renderBanners(banners){
 if(bannersRendered||!Array.isArray(banners)||!banners.length)return;bannersRendered=true;
 heroBox.innerHTML=banners.map((b,i)=>{const href=b.event_id?`#event-${b.event_id}`:b.link_url||'#activities',external=/^https:/.test(href),label=b.title||b.alt;
  return `<div class="hero-slide banner-slide" data-hero-slide="${i}" data-hero-title="${esc(label)}"><div class="banner-media"><img${b.height>b.width*1.05?' class="is-portrait"':''} src="/media/${esc(b.image_id)}" alt="${esc(b.alt)}" ${b.width&&b.height?`width="${b.width}" height="${b.height}"`:''} ${i?'loading="lazy"':''} decoding="async"></div>${b.title||b.subtitle||b.event_id?`<div class="ai-hero-footer"${b.event_id?` data-featured-event="${esc(b.event_id)}"`:''}${b.title?' data-fixed-title':''}${b.subtitle?' data-fixed-subtitle':''}><div><strong>${esc(b.title)}</strong><span>${esc(b.subtitle)}</span></div><a class="button" href="${esc(href)}"${external?' target="_blank" rel="noopener noreferrer"':''}>${b.event_id?'查看活動詳情':'了解更多'} <span aria-hidden="true">${external?'↗':'↓'}</span></a></div>`:''}</div>`;}).join('');
 heroSlides=[...heroBox.children];
 heroDotsBox.innerHTML=banners.map((b,i)=>`<button class="hero-dot" type="button" data-hero-target="${i}" aria-label="顯示${esc(b.title||b.alt)}" aria-current="false"></button>`).join('');heroDots=[...heroDotsBox.children];
 heroControls.hidden=banners.length<2;heroIndex=0;showHero(0);
}
const mascot=document.querySelector('.community-mascot'),mascotToggle=document.querySelector('#mascot-toggle'),mascotPanel=document.querySelector('#mascot-panel'),mascotRegister=document.querySelector('#mascot-register'),mascotRegisterNote=document.querySelector('#mascot-register-note');
function setMascotOpen(open){if(open)track('mascot_open');mascotPanel.hidden=!open;mascotToggle.setAttribute('aria-expanded',String(open));mascot.classList.toggle('is-open',open);if(open)mascotPanel.querySelector('.mascot-close').focus();}
function isSessionOpen(s,now=Date.now()){return Boolean(s.registration_open&&s.status==='published'&&Date.parse(s.starts_at)>now&&Date.parse(s.ends_at)>now&&(!s.opens_at||Date.parse(s.opens_at)<=now)&&(!s.closes_at||Date.parse(s.closes_at)>now));}
function firstOpenSession(){for(const event of data?.events||[]){const session=event.sessions.find(s=>isSessionOpen(s));if(session)return session;}}
function updateMascotRegistration(state){publicDataState=state;const session=state==='ready'&&firstOpenSession();mascotRegister.disabled=state==='loading';mascotRegister.setAttribute('aria-busy',String(state==='loading'));mascotRegisterNote.textContent=state==='loading'?'正在載入活動…':state==='error'?'活動資料暫時無法載入':session?'直接開啟活動表單':'查看目前活動狀態';}
function scrollToElement(selector){document.querySelector(selector)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
mascotToggle.addEventListener('click',()=>setMascotOpen(mascotPanel.hidden));
mascotPanel.querySelector('.mascot-close').addEventListener('click',()=>{setMascotOpen(false);mascotToggle.focus();});
mascotRegister.addEventListener('click',()=>{track('mascot_action',{action:'register'});const session=publicDataState==='ready'&&firstOpenSession();setMascotOpen(false);if(session){openForm(session.id,{},'mascot');return;}mascotToggle.focus({preventScroll:true});scrollToElement('#activities');toast(publicDataState==='error'?'活動資料暫時無法載入，請稍後再試。':'目前沒有開放報名的場次。');});
document.querySelector('#mascot-top').addEventListener('click',()=>{track('mascot_action',{action:'top'});setMascotOpen(false);mascotToggle.focus({preventScroll:true});window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
for(const link of mascotPanel.querySelectorAll('.mascot-link'))link.addEventListener('click',()=>setMascotOpen(false));
document.addEventListener('pointerdown',event=>{if(!mascotPanel.hidden&&!mascot.contains(event.target))setMascotOpen(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!mascotPanel.hidden){setMascotOpen(false);mascotToggle.focus();}});
// Mobile header menu: residents get the site links; the admin entrance lives in the footer on phones.
const siteHeader=document.querySelector('.site-header'),navToggle=document.querySelector('.nav-toggle');
function setNavOpen(open){siteHeader.classList.toggle('is-open',open);navToggle.setAttribute('aria-expanded',String(open));}
navToggle.addEventListener('click',()=>setNavOpen(!siteHeader.classList.contains('is-open')));
document.querySelector('#site-nav').addEventListener('click',event=>{if(event.target.closest('a'))setNavOpen(false);});
document.addEventListener('pointerdown',event=>{if(siteHeader.classList.contains('is-open')&&!siteHeader.contains(event.target))setNavOpen(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&siteHeader.classList.contains('is-open')){setNavOpen(false);navToggle.focus();}});
// Keep the mascot off the hero so it never covers the carousel controls or CTA; it arrives once the visitor scrolls on.
const mascotHero=document.querySelector('.campaign-hero');let mascotFrame=0;
function placeMascot(){mascotFrame=0;mascot.classList.toggle('is-away',Boolean(mascotHero)&&mascotPanel.hidden&&mascotHero.getBoundingClientRect().bottom>innerHeight-110);}
function queueMascot(){if(!mascotFrame)mascotFrame=requestAnimationFrame(placeMascot);}
addEventListener('scroll',queueMascot,{passive:true});addEventListener('resize',queueMascot);placeMascot();
function sessionMarkup(s,title=''){
 const ended=Date.parse(s.ends_at)<Date.now(),notStarted=Date.parse(s.starts_at)>Date.now();
 const open=isSessionOpen(s);
 const label=s.status==='cancelled'?'已取消':ended?'活動已結束':open?'開放報名':'尚未開放';const free=Math.max(0,s.capacity-s.occupied);
 return `<div class="session"><div class="session-top"><span class="session-date">${esc(dateLabel(s.starts_at))}</span><span class="pill ${open?'':'orange'}">${label}</span></div><div class="session-meta"><span>◷ ${esc(time(s.starts_at))}–${esc(time(s.ends_at))}</span><span>⌖ ${esc(s.location)}</span><span>${feeBadge(s)} ${esc(s.fee)}</span></div><div class="session-actions">${open?`<button class="button join-button" data-id="${esc(s.id)}">${free?'我要報名':'登記候補'} ↗</button><span>剩餘 ${free} 位／共 ${s.capacity} 位</span>`:`<button class="button secondary" disabled>${label}</button><span>${s.capacity?`共 ${s.capacity} 位`:'名額待定'}</span>`}</div>${calendarMenu(s,title)}${s.supplies?`<p class="session-note">${esc(s.supplies)}</p>`:''}${!open&&!ended&&s.status!=='cancelled'?'<p class="session-note">地點、名額與費用確認後，將在這裡開放報名。</p>':''}</div>`;
}
const time=v=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
function syncFeaturedActivity(events){
 for(const footer of document.querySelectorAll('[data-featured-event]')){
  const event=events.find(event=>event.id===footer.dataset.featuredEvent);
  const session=event?.sessions.filter(session=>session.status==='published'&&Date.parse(session.ends_at)>=Date.now()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
  if(event&&!('fixedTitle' in footer.dataset))footer.querySelector('strong').textContent=event.title;
  if('fixedSubtitle' in footer.dataset)continue;
  footer.querySelector('span').textContent=session?`${dateLabel(session.starts_at)} ${time(session.starts_at)}–${time(session.ends_at)}${event.notes?.includes('日期與時間暫定')?'（暫定）':''}${session.fee&&session.fee!=='待定'?' · '+session.fee:''}`:'場次資訊請見活動列表';
 }
}
async function load(){
 updateMascotRegistration('loading');
 try{data=await api('/api/public');updateMascotRegistration('ready');renderBanners(data.banners);syncFeaturedActivity(data.events);document.querySelector('#events').innerHTML=data.events.length?data.events.map(e=>{
  const upcoming=e.sessions.filter(s=>Date.parse(s.ends_at)>=Date.now()),past=e.sessions.filter(s=>Date.parse(s.ends_at)<Date.now());
  const galleryPhotos=e.photos.filter(p=>p.id!==e.cover_photo_id);
  const sessions=`${upcoming.slice(0,1).map(s=>sessionMarkup(s,e.title)).join('')}${upcoming.length>1?`<details><summary>更多場次（${upcoming.length-1}）</summary>${upcoming.slice(1).map(s=>sessionMarkup(s,e.title)).join('')}</details>`:''}${past.length?`<details><summary>過往活動（${past.length}）</summary>${past.map(s=>sessionMarkup(s,e.title)).join('')}</details>`:''}${!e.sessions.length?'<p>場次準備中，敬請期待。</p>':''}`;
  const gallery=galleryPhotos.length?`<div class="gallery" aria-label="活動照片">${galleryPhotos.map(p=>`<button class="photo-button" data-id="${esc(p.id)}" data-caption="${esc(p.caption)}" aria-label="放大${esc(p.caption||'活動照片')}"><img src="/media/${esc(p.id)}?thumb=1" alt="${esc(p.caption||'活動照片')}" loading="lazy"></button>`).join('')}</div>`:'';
  return `<article id="event-${esc(e.id)}" data-event-id="${esc(e.id)}" class="event-card${e.cover_photo_id?' has-cover':''}"><div class="event-visual">${e.cover_photo_id?`<img src="/media/${esc(e.cover_photo_id)}" alt="${esc(e.title)}" loading="lazy" decoding="async">`:'<div class="shield" aria-hidden="true">✓</div><strong>一起參與<br>社區活動</strong><span>LEARN · CONNECT · PARTICIPATE</span>'}</div><div class="event-body"><div class="event-intro"><span class="pill">社區活動</span><h3>${esc(e.title)}</h3><p class="event-description">${esc(e.description)}</p>${eventNotesMarkup(e)}${e.contact?`<p class="session-note">主辦方聯絡：${esc(e.contact)}</p>`:''}${gallery}</div><div class="event-sessions">${sessions}</div></div></article>`;
 }).join(''):'<p class="empty">活動準備中，歡迎稍後回來看看。</p>';
 for(const b of document.querySelectorAll('.join-button'))b.addEventListener('click',()=>openForm(b.dataset.id,{},'activity_card'));
 observeContent();
 for(const b of document.querySelectorAll('.photo-button'))b.addEventListener('click',()=>{track('photo_view',{event_id:b.closest('[data-event-id]').dataset.eventId});document.querySelector('#large-photo').src='/media/'+b.dataset.id;document.querySelector('#large-photo').alt=b.dataset.caption||'活動照片';document.querySelector('#photo-caption').textContent=b.dataset.caption;document.querySelector('#photo-dialog').showModal();});
 }catch(e){updateMascotRegistration('error');document.querySelector('#events').innerHTML=`<p class="error">${esc(e.message)}</p><button class="button secondary" id="reload">重新載入</button>`;document.querySelector('#reload').onclick=load;}
}
async function openForm(id,previous={},entryPoint=registrationContext.entry_point||'activity_card') {
 if(submitting)return;const request=++formRequest;dropTurnstile();
 registrationContext={activity_session_id:id,event_id:data?.events.find(e=>e.sessions.some(s=>s.id===id))?.id,entry_point:entryPoint};formStarted=false;
 if(!dialog.open)dialog.showModal();content.innerHTML='<p class="loading">載入報名表…</p>';
 try{const info=await api(`/api/sessions/${id}/form`);if(request!==formRequest)return;activeSession=id;activeForm=info;submissionId=crypto.randomUUID();
 const event=data.events.find(e=>e.sessions.some(s=>s.id===id));
 content.innerHTML=`<h2 id="registration-title">${esc(event.title)}</h2><p class="event-description">${esc(dateLabel(info.session.starts_at))} ${esc(time(info.session.starts_at))} · ${esc(info.session.location)}</p><form id="registration-form" novalidate><div id="form-errors" role="alert"></div>${info.form.fields.filter(f=>f.enabled).map(f=>f.id==='name'?`<div class="form-field handwritten-name"><label id="handwritten-name-label">請幫我填寫真實姓名${f.required?' <span class="required">*</span>':''}</label><p class="help" id="handwritten-name-help">請在手寫板上用手指或觸控筆寫下姓名。</p><canvas id="name-handwriting" class="name-handwriting-pad" width="800" height="280" aria-labelledby="handwritten-name-label" aria-describedby="handwritten-name-help"></canvas><div class="handwriting-actions"><button class="button secondary" type="button" id="undo-name">復原上一筆</button><button class="button secondary" type="button" id="clear-name">清除重寫</button></div><details id="typed-name-option" ${previous.name?'open':''}><summary>改用鍵盤輸入姓名</summary>${fieldMarkup({...f,label:'鍵盤輸入姓名',required:false},previous[f.id])}</details><p class="field-error error" data-error="handwritten_name" role="alert"></p></div>`:fieldMarkup(f,previous[f.id])).join('')}${info.form.participants?`<section class="participant-sheet" aria-labelledby="participant-sheet-title"><h3 id="participant-sheet-title">參加者簽到資料</h3><p class="help">依參加人數填寫每位參加者，資料會直接帶入活動簽到表。大人／小孩、性別與身分可留空。</p><div id="participant-rows"></div><p class="field-error error" data-error="participants" role="alert"></p></section>`:''}<div class="consent"><strong>個人資料使用說明</strong><p>${esc(info.privacy.summary)}</p><details><summary>閱讀完整說明</summary><p>${esc(info.privacy.body)}</p></details><label><input type="checkbox" name="privacy_consent" required>我已閱讀並同意個人資料使用說明。</label><label><input type="checkbox" name="participation_consent" required>${esc(info.privacy.statement)}</label></div><p class="fee-estimate" id="fee-estimate" aria-live="polite"></p><p class="help">名額依參加人數計算。收到報名不代表名額已確認，請以主辦方確認信為準。</p>${info.turnstile_site_key?'<div class="turnstile-field"><div id="turnstile-widget"></div><p class="field-error error" data-error="turnstile" role="alert"></p></div>':''}<button class="button" type="submit">送出報名 ↗</button></form>`;
 const form=document.querySelector('#registration-form');
 const pad=form.querySelector('#name-handwriting');namePad=pad?signaturePad(pad,previous.__name_signature||[]):null;
 if(pad){form.querySelector('#clear-name').onclick=()=>namePad.clear();form.querySelector('#undo-name').onclick=()=>namePad.undo();pad.addEventListener('pointerdown',()=>form.dispatchEvent(new Event('input',{bubbles:true})));}
 if(info.form.participants){const count=form.elements.participant_count,draw=()=>drawParticipants(form,info,Number(count?.value)||1);participantDraft=Array.isArray(previous.__participants)?previous.__participants:[];draw();count?.addEventListener('input',draw);}
 const estimate=()=>{form.querySelector('#fee-estimate').textContent=feeEstimate(info.session,Number(form.elements.participant_count?.value)||1);};estimate();form.elements.participant_count?.addEventListener('input',estimate);
 track('registration_open',registrationContext);
 const start=()=>{if(!formStarted){formStarted=true;track('registration_start',registrationContext);}};
 form.addEventListener('input',start);form.addEventListener('change',start);
 form.addEventListener('submit',submit);
 if(info.turnstile_site_key)mountTurnstile(form,info.turnstile_site_key,request);
 }catch(e){if(request!==formRequest)return;track('registration_error',{...registrationContext,error_type:errorType(e)});content.innerHTML=`<p class="error">${esc(e.message)}</p>`;}
}
// Payment is handled by the organizer (on site, transfer…); the site only shows the expected total.
function feeEstimate(s,people){
 if(s.fee_type==='free')return '本場次免費參加。';
 if(s.fee_type!=='paid'||!Number.isInteger(s.fee_amount))return s.fee&&s.fee!=='待定'?`費用：${s.fee}`:'';
 const n=Math.max(1,Math.floor(people)||1);return `應繳費用：${n} 人 × ${s.fee_amount.toLocaleString('zh-TW')} 元 = ${(n*s.fee_amount).toLocaleString('zh-TW')} 元${s.fee_note?`（${s.fee_note}）`:''}。繳費方式依主辦方說明，本網站不會收款。`;
}
// Mirrors the paper sign-in sheet: one block per seat with 姓名, 大／小 + 性別, 身分 and the session's fee.
let participantDraft=[];
function feeText(fee){const t=String(fee||'').trim(),amount=(t.match(/\d[\d,]*/)?.[0]||'').replaceAll(',','');return t==='免費'?'☑ 免費':amount?`☑ 繳費 ${amount} 元`:t||'依主辦方公告';}
function readParticipants(form){return [...form.querySelectorAll('.participant-row')].map(row=>{const v=k=>row.querySelector(`input[data-k="${k}"]:checked`)?.value||'';return {name:row.querySelector('input[data-k=name]').value.trim(),age_group:v('age_group'),gender:v('gender'),identity:v('identity')};});}
function drawParticipants(form,info,count){
 const box=form.querySelector('#participant-rows');if(!box)return;const max=info.form.participants.max,n=Math.max(1,Math.min(max,Math.floor(count)||1));
 const current=box.children.length?readParticipants(form):[];current.forEach((p,i)=>participantDraft[i]=p);
 const radios=(i,k,list,p)=>list.map(o=>`<label class="participant-choice"><input type="radio" name="participant-${i}-${k}" data-k="${k}" value="${esc(o)}" ${p[k]===o?'checked':''}><span>${esc(o)}</span></label>`).join('');
 box.innerHTML=Array.from({length:n},(_,i)=>{const p=participantDraft[i]||{};return `<fieldset class="participant-row"><legend>序號 ${i+1}</legend><div class="participant-grid"><label class="participant-label" for="participant-${i}-name">姓名${i?' <span class="required" aria-label="必填">*</span>':''}</label><div><input id="participant-${i}-name" data-k="name" maxlength="50" autocomplete="${i?'off':'name'}" placeholder="${i?'請填寫姓名':'可留空，使用上方報名人姓名'}" value="${esc(p.name||'')}"></div><span class="participant-label">大人／小孩</span><div class="participant-options" role="radiogroup" aria-label="序號 ${i+1} 大人或小孩">${radios(i,'age_group',info.form.participants.age_groups,p)}</div><span class="participant-label">性別</span><div class="participant-options" role="radiogroup" aria-label="序號 ${i+1} 性別">${radios(i,'gender',info.form.participants.genders,p)}</div><span class="participant-label">身分</span><div class="participant-options identity" role="radiogroup" aria-label="序號 ${i+1} 身分">${radios(i,'identity',info.form.participants.identities,p)}</div><span class="participant-label">活動收費情形</span><p class="participant-fee">${esc(feeText(info.session.fee))}</p></div></fieldset>`;}).join('')+(count>max?`<p class="help">參加人數超過 ${max} 位時，僅需填寫前 ${max} 位，其餘由工作人員現場登記。</p>`:'');
}
// Turnstile only when the server sends a site key: loaded on first use, one widget per rendered form.
let turnstileWidget=null,turnstileScript=null;
function loadTurnstile(){return turnstileScript??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=()=>window.turnstile?resolve(window.turnstile):reject(Error());s.onerror=()=>{turnstileScript=null;s.remove();reject(Error());};document.head.append(s);});}
function dropTurnstile(){if(turnstileWidget===null)return;try{window.turnstile.remove(turnstileWidget);}catch{}turnstileWidget=null;}
function resetTurnstile(){if(turnstileWidget===null)return;try{window.turnstile.reset(turnstileWidget);}catch{}}
function turnstileToken(){if(turnstileWidget===null)return '';try{return window.turnstile.getResponse(turnstileWidget)||'';}catch{return '';}}
async function mountTurnstile(form,sitekey,request){
 const box=form.querySelector('#turnstile-widget'),error=form.querySelector('[data-error=turnstile]');
 try{const ts=await loadTurnstile();if(request!==formRequest||!box.isConnected)return;dropTurnstile();
  turnstileWidget=ts.render(box,{sitekey,action:'register',language:'zh-tw',size:box.clientWidth<300?'compact':'normal',callback:()=>{error.textContent='';},'expired-callback':()=>{error.textContent='驗證已逾時，請重新完成驗證';},'error-callback':()=>{error.textContent='真人驗證發生問題，請重新整理頁面後再試';}});
 }catch{error.textContent='無法載入真人驗證，請確認網路連線，或暫停阻擋外部內容的外掛後重新整理';}
}
async function submit(event){
 event.preventDefault();if(submitting)return;submitting=true;const context={...registrationContext},currentSubmission=submissionId;const form=event.currentTarget,button=form.querySelector('button[type=submit]'),answers=readAnswers(form,activeForm.form.fields),nameSignature=namePad?.read()||[],participants=activeForm.form.participants?readParticipants(form):undefined;button.disabled=true;document.querySelector('#form-errors').innerHTML='';
 for(const el of form.querySelectorAll('.field-error'))el.textContent='';
 const turnstileTokenValue=turnstileToken();
 if(activeForm.turnstile_site_key&&!turnstileTokenValue){const message=turnstileWidget===null?'無法載入真人驗證，請確認網路連線後重新整理頁面':'請先完成送出按鈕上方的「確認您是真人」驗證';form.querySelector('[data-error=turnstile]').textContent=message;document.querySelector('#form-errors').innerHTML=`<p class="error form-error">${esc(message)}</p>`;form.querySelector('.turnstile-field').scrollIntoView({block:'center',behavior:'smooth'});button.disabled=false;submitting=false;return;}
 try{
 track('registration_submit',context);
 const result=await api(`/api/sessions/${activeSession}/registrations`,{method:'POST',body:{form_id:activeForm.form.id,submission_id:submissionId,answers,name_signature:nameSignature.length?nameSignature:null,participants,privacy_version:activeForm.privacy.version,privacy_consent:form.elements.privacy_consent.checked,participation_consent:form.elements.participation_consent.checked,turnstile_token:turnstileTokenValue||undefined}});dropTurnstile();
 if(!trackedSubmissions.has(currentSubmission)){trackedSubmissions.add(currentSubmission);track('registration_success',{...context,registration_status:result.status,participant_count:result.seats});}
 content.innerHTML=`<div class="success"><div class="success-mark" aria-hidden="true">✓</div><h2 id="registration-title">已收到您的報名</h2><div class="success-code">${esc(result.code)}</div><span class="pill">${esc(statusLabel(result.status))} · ${result.seats} 位</span><p class="session-note">${result.status==='waitlisted'?'目前剩餘名額不足，整筆報名已進入候補。主辦方遞補後會寄出確認通知。':'您的報名正在等待主辦方確認；收到報名不代表名額已確認。'}</p><p>請保存報名編號，並留意您的 Email。通知可能稍後寄出。</p>${result.status==='waitlisted'?'':calendarMenu(activeForm.session,data?.events.find(e=>e.id===context.event_id)?.title||'')}<button class="button" id="done">完成</button></div>`;document.querySelector('#done').onclick=()=>dialog.close();load();
 }catch(e){
 track('registration_error',{...context,error_type:errorType(e)});
 // Tokens are single-use: any failed attempt needs a fresh one.
 resetTurnstile();
 document.querySelector('#form-errors').innerHTML=`<p class="error form-error">${esc(e.message)}</p>`;
 if(e.details?.reload){const b=document.createElement('button');b.type='button';b.className='button secondary';b.textContent='重新載入並保留相容答案';b.onclick=()=>openForm(activeSession,{...answers,__name_signature:nameSignature,__participants:participants});document.querySelector('#form-errors').append(b);}
 else for(const [id,message]of Object.entries(e.details||{})){const el=form.querySelector(`[data-error="${CSS.escape(id)}"]`);if(el)el.textContent=message;if(id==='name'){form.querySelector('[data-error=handwritten_name]').textContent=message;}}
 document.querySelector('#form-errors').scrollIntoView({block:'center',behavior:'smooth'});button.disabled=false;
 }finally{submitting=false;if(!dialog.open)window.dispatchEvent(new Event('analytics-reload-ready'));}
}

// Keep an open registration in memory; reload only after it can safely close.
window.addEventListener('analytics-before-reload',event=>{if(dialog.open||submitting)event.preventDefault();});
dialog.addEventListener('close',()=>{if(!submitting)dropTurnstile();if(!submitting)window.dispatchEvent(new Event('analytics-reload-ready'));});
load();
