import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sanitizeParams,safeLocation,consentValue,errorType} from '../public/analytics.js';
import {handle} from '../src/worker.js';

test('analytics strips personal fields, unsafe values, query strings and fragments',()=>{
 assert.deepEqual(sanitizeParams({event_id:'anti-fraud',activity_session_id:'s-1',email:'a@example.com',answers:{},entry_point:'a@example.com',participant_count:3,registration_status:'waitlisted',code:'DN-1'}),{event_id:'anti-fraud',activity_session_id:'s-1',participant_count:3,registration_status:'waitlisted'});
 assert.equal(safeLocation('https://events.example.org/?email=a@example.com&utm_source=line#private'),'https://events.example.org/');
 assert.equal(errorType({status:400,message:'private answer'}),'validation');
 assert.equal(errorType({status:409,details:{reload:true}}),'form_changed');
});
test('consent expires after 180 days and rejects invalid storage',()=>{
 const store=value=>({getItem:()=>JSON.stringify(value)});
 assert.equal(consentValue(store({value:'granted',expires:200}),100),'granted');
 assert.equal(consentValue(store({value:'granted',expires:99}),100),null);
 assert.equal(consentValue(store({value:'other',expires:200}),100),null);
 assert.equal(consentValue({getItem(){throw Error();}},100),null);
});
test('configuration is production-only and public CSP does not loosen admin policy',async()=>{
 const env={APP_ENV:'production',GA4_MEASUREMENT_ID:'G-TEST123',ASSETS:{fetch:async()=>new Response('ok')}};
 const get=(path,overrides={},host='events.example.org')=>handle(new Request('https://'+host+path),{...env,...overrides});
 assert.deepEqual(await (await get('/analytics-config')).json(),{measurement_id:'G-TEST123',host:'events.example.org'});
 assert.deepEqual(await (await get('/analytics-config',{SITE_URL:'https://other.example.org'})).json(),{measurement_id:null,host:null},'GA only on the SITE_URL host');
 assert.deepEqual(await (await get('/analytics-config',{APP_ENV:'staging'})).json(),{measurement_id:null,host:null});
 assert.deepEqual(await (await get('/analytics-config',{},'localhost')).json(),{measurement_id:null,host:null});
 assert.deepEqual(await (await get('/analytics-config',{GA4_MEASUREMENT_ID:'invalid'})).json(),{measurement_id:null,host:null});
 assert.match((await get('/')).headers.get('Content-Security-Policy'),/https:\/\/www.googletagmanager.com/);
 assert.doesNotMatch((await get('/admin/',{APP_ENV:'development'})).headers.get('Content-Security-Policy'),/google/);
});

function browser(choice=null){
 const listeners={},panel={hidden:true,querySelector:()=>({addEventListener:(name,fn)=>{},focus(){}})};
 const buttons={};panel.querySelector=selector=>buttons[selector]??=({addEventListener:(name,fn)=>{buttons[selector].click=fn;},focus(){}});
 const storage=new Map(choice?[['dn_analytics_consent',JSON.stringify({value:choice,expires:Date.now()+100000})]]:[]);
 const scripts=[],calls=[];
 const context={URL,Set,Map,Date,JSON,Event,setTimeout,clearTimeout,location:{hostname:'events.example.org',href:'https://events.example.org/?email=private&utm_source=line#private',reload(){calls.push('reload');}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>({ok:true,json:async()=>({measurement_id:'G-TEST123',host:'events.example.org'})}),document:{referrer:'https://example.com/?email=private',cookie:'',hidden:false,head:{append:script=>scripts.push(script)},createElement:()=>({}),querySelector:s=>s==='#analytics-preferences'?panel:{addEventListener(){}},querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn},window:{addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:()=>true}};
 vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../public/analytics.js',import.meta.url),'utf8').replaceAll('export ','' )+'\nglobalThis.analytics={initAnalytics,track,choose};',context);
 return {context,scripts,calls,panel,listeners,storage,async init(){await context.analytics.initAnalytics();},events(){return (context.window.dataLayer||[]).filter(args=>args[0]==='event');}};
}
test('no Google load before consent; no replay; one page view after granting',async()=>{
 const b=browser();await b.init();assert.equal(b.scripts.length,0);assert.equal(b.panel.hidden,false);
 b.context.analytics.track('registration_submit',{email:'private'});
 b.context.analytics.choose('granted');b.context.analytics.choose('granted');
 assert.equal(b.scripts.length,1);assert.equal(JSON.stringify(b.events().map(x=>x[1])),JSON.stringify(['page_view']));
 const config=b.context.window.dataLayer.find(x=>x[0]==='config')[2];assert.equal(config.page_location,'https://events.example.org/');assert.equal(config.page_referrer,'https://example.com/');assert.equal(config.campaign_source,'line');
 b.context.analytics.choose('denied');b.context.analytics.track('registration_success');assert.equal(b.context.window['ga-disable-G-TEST123'],true);assert.deepEqual(b.calls,['reload']);assert.equal(b.events().length,0);
});
test('saved denial stays offline; saved grant loads analytics; blocked tag is harmless',async()=>{
 const denied=browser('denied');await denied.init();assert.equal(denied.scripts.length,0);
 const granted=browser('granted');await granted.init();assert.equal(granted.events().length,1);granted.scripts[0].onerror();granted.context.analytics.track('registration_success');assert.equal(granted.events().length,0);
});

test('visibility requires 50% for a full second, cancels on hide and deduplicates after rerender',async()=>{
 const b=browser('granted'),timers=new Map(),elements=[{id:'safety',dataset:{},isConnected:true},{dataset:{eventId:'event-1'},isConnected:true}];
 let sequence=0,callback;
 b.context.setTimeout=(fn,delay)=>{assert.equal(delay,1000);timers.set(++sequence,fn);return sequence;};
 b.context.clearTimeout=id=>timers.delete(id);
 b.context.window.IntersectionObserver=true;
 b.context.IntersectionObserver=class{constructor(fn){callback=fn;}observe(){}unobserve(){}disconnect(){}};
 b.context.document.querySelectorAll=()=>elements;
 await b.init();
 callback([{target:elements[0],intersectionRatio:.49}]);assert.equal(timers.size,0);
 callback([{target:elements[0],intersectionRatio:.5}]);assert.equal(timers.size,1);
 callback([{target:elements[0],intersectionRatio:0}]);assert.equal(timers.size,0);
 callback([{target:elements[0],intersectionRatio:.5},{target:elements[1],intersectionRatio:.5}]);
 for(const fn of [...timers.values()])fn();timers.clear();
 assert.equal(b.events().filter(x=>x[1]==='section_view').length,1);assert.equal(b.events().filter(x=>x[1]==='event_view').length,1);
 callback([{target:elements[0],intersectionRatio:.5}]);assert.equal(timers.size,0);
});

function registrationUI(){
 const events=[],handlers={},button={disabled:false},form={elements:{privacy_consent:{checked:true},participation_consent:{checked:true}},querySelector:selector=>selector==='#name-handwriting'?null:button,querySelectorAll:()=>[],addEventListener:(name,fn)=>handlers[name]=fn};
 const ui={innerHTML:'',textContent:'',scrollIntoView(){},append(){}};
 let response={code:'PRIVATE',status:'pending',seats:3},reject,deferred;
 const context={Set,Date,JSON,namePad:null,registrationContext:{},formStarted:false,submitting:false,formRequest:0,trackedSubmissions:new Set(),data:{events:[{id:'event-1',title:'測試活動',sessions:[{id:'session-1'}]}]},dialog:{open:false,showModal(){this.open=true;},close(){this.open=false;}},content:ui,document:{querySelector:selector=>selector==='#registration-form'?form:selector==='#done'?{}:ui,createElement:()=>ui},crypto:{randomUUID:()=> 'private-submission-id'},api:async path=>{if(path.endsWith('/form'))return {session:{starts_at:'2026-11-01T00:00:00Z',location:'社區'},form:{id:'form-1',fields:[]},privacy:{summary:'',body:'',statement:'',version:'v1'}};if(reject)throw reject;if(deferred)return deferred;return response;},track:(name,params)=>events.push({name,params:JSON.parse(JSON.stringify(params))}),errorType,readAnswers:()=>({email:'private@example.com'}),esc:x=>x,dateLabel:()=>'',time:()=>'',fieldMarkup:()=>'',statusLabel:x=>x,load(){},CSS:{escape:x=>x},window:{dispatchEvent(){}},Event};
 vm.createContext(context);
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('async function openForm('),source.indexOf('// Keep an open registration')),context);
 return {context,events,handlers,form,setResponse:value=>response=value,setError:value=>reject=value,setDeferred:value=>deferred=value};
}
test('registration start once per form; successful and waitlisted results retain context without personal data',async()=>{
 const b=registrationUI();await b.context.openForm('session-1',{},'mascot');b.handlers.input();b.handlers.change();
 assert.equal(b.events.filter(e=>e.name==='registration_start').length,1);
 await b.context.submit({preventDefault(){},currentTarget:b.form});await b.context.submit({preventDefault(){},currentTarget:b.form});
 assert.equal(b.events.filter(e=>e.name==='registration_success').length,1);
 const success=b.events.find(e=>e.name==='registration_success');assert.deepEqual(success.params,{activity_session_id:'session-1',event_id:'event-1',entry_point:'mascot',registration_status:'pending',participant_count:3});
 assert.doesNotMatch(JSON.stringify(b.events),/private|PRIVATE|example.com/);
 const waiting=registrationUI();waiting.setResponse({status:'waitlisted',seats:5,code:'PRIVATE'});await waiting.context.openForm('session-1',{},'activity_card');await waiting.context.submit({preventDefault(){},currentTarget:waiting.form});assert.equal(waiting.events.find(e=>e.name==='registration_success').params.registration_status,'waitlisted');
});
test('double submit while pending is ignored, failures can retry and emit classified errors',async()=>{
 const b=registrationUI();await b.context.openForm('session-1');let finish;
 b.setDeferred(new Promise(resolve=>finish=resolve));const first=b.context.submit({preventDefault(){},currentTarget:b.form});await b.context.submit({preventDefault(){},currentTarget:b.form});assert.equal(b.events.filter(e=>e.name==='registration_submit').length,1);finish({status:'pending',seats:1});await first;
 const failed=registrationUI();await failed.context.openForm('session-1');failed.setError({status:400,message:'private answer'});await failed.context.submit({preventDefault(){},currentTarget:failed.form});assert.equal(failed.events.at(-1).params.error_type,'validation');failed.setError(null);await failed.context.submit({preventDefault(){},currentTarget:failed.form});assert.equal(failed.events.filter(e=>e.name==='registration_success').length,1);
});


test('clearing consent in another tab disables GA, even when cookie access throws',async()=>{
 const b=browser('granted');await b.init();b.storage.clear();
 Object.defineProperty(b.context.document,'cookie',{get(){throw Error('cookies blocked');}});
 b.listeners.storage({key:null});
 assert.equal(b.context.window['ga-disable-G-TEST123'],true);
 assert.deepEqual(b.calls,['reload']);assert.equal(b.events().length,0);
});
test('a failed Google script can be retried after a new grant',async()=>{
 const b=browser('granted');await b.init();b.scripts[0].onerror();
 b.context.analytics.choose('granted');assert.equal(b.scripts.length,2);
 assert.equal(b.context.window['ga-disable-G-TEST123'],false);
 assert.equal(b.events().filter(event=>event[1]==='page_view').length,1);
});

test('withdrawal defers reload while registration is open and completes when safe',async()=>{
 const b=browser('granted');await b.init();b.context.window.dispatchEvent=()=>false;
 b.context.analytics.choose('denied');assert.equal(b.calls.length,0);
 assert.equal(b.context.window['ga-disable-G-TEST123'],true);
 b.listeners['analytics-reload-ready']();assert.deepEqual(b.calls,['reload']);
});

test('featured activity dates, tentative status and fees follow each live event',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const makeFooter=id=>{const title={},label={};return {title,label,dataset:{featuredEvent:id},querySelector:selector=>selector==='strong'?title:label};};
 const ai=makeFooter('ai-short-video'),digital=makeFooter('digital-life');
 const context={Date,document:{querySelectorAll:()=>[ai,digital]},dateLabel:value=>value.slice(0,10),time:value=>value.slice(11,16)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function syncFeaturedActivity('),source.indexOf('async function load(')),context);
 const session={status:'published',starts_at:'2099-11-21T05:30:00Z',ends_at:'2099-11-21T06:30:00Z'};
 context.syncFeaturedActivity([{id:'ai-short-video',title:'新標題',sessions:[session]},{id:'digital-life',title:'手機與 3C 生活應用教學',notes:'日期與時間暫定',sessions:[{...session,fee:'免費',starts_at:'2099-12-27T05:30:00Z',ends_at:'2099-12-27T06:30:00Z'}]}]);
 assert.equal(ai.title.textContent,'新標題');assert.equal(ai.label.textContent,'2099-11-21 05:30–06:30');
 assert.equal(digital.title.textContent,'手機與 3C 生活應用教學');assert.equal(digital.label.textContent,'2099-12-27 05:30–06:30（暫定） · 免費');
 context.syncFeaturedActivity([{id:'digital-life',title:'改期活動',notes:'日期已確認',sessions:[{...session,fee:'待定'}]}]);
 assert.equal(digital.label.textContent,'2099-11-21 05:30–06:30');
 context.syncFeaturedActivity([]);assert.equal(ai.label.textContent,'場次資訊請見活動列表');assert.equal(digital.label.textContent,'場次資訊請見活動列表');
});
