import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {esc} from '../public/shared.js';
import {paintSignature} from '../public/signature.js';
import {timeRange} from '../public/admin/signin-format.js';

test('簽到表以原筆跡繪製姓名，保留活動與選填欄位，列印及加空白列不遺失簽名',async()=>{
 const strokes=[[[0.1,0.2],[0.5,0.5],[0.8,0.3]]],calls=[],canvases=[];
 const sheet={innerHTML:'',querySelectorAll(){canvases.length=0;for(const _ of this.innerHTML.matchAll(/class="printed-signature"/g)){const commands=[],ctx=Object.fromEntries(['clearRect','beginPath','moveTo','lineTo','stroke','arc','fill'].map(name=>[name,(...args)=>commands.push([name,...args])]));canvases.push({width:800,height:280,commands,getContext:()=>ctx});}return canvases;}};
 const note={},blank={value:'0'},printButton={},nodes={'#sheet':sheet,'#sheet-note':note,'#blank-rows':blank,'#print-sheet':printButton};
 const data={session:{event_id:'demo',title:'活動格式測試',starts_at:'2030-12-27T05:30:00Z',ends_at:'2030-12-27T06:30:00Z',location:'社區教室',fee:'免費'},rows:[{full_name:'（手寫姓名）',signature_json:JSON.stringify(strokes),age_group:'大',gender:'女',identity:'附近居民',fee_status:'paid',fee_amount:150,fee_snapshot:'免費'}]};
 const context=vm.createContext({Intl,Date,Number,Math,Array,JSON,URLSearchParams,decodeURIComponent,location:{hash:'#demo'},document:{title:'',querySelector:s=>nodes[s]},api:async path=>{calls.push(path);return data;},esc,paintSignature,timeRange,siteConfig:async()=>({}),print:()=>calls.push('print')});
 const source=readFileSync(new URL('../public/admin/checkin-sheet.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 await vm.runInContext(source,context);
 assert.match(sheet.innerHTML,/活動格式測試 – 簽到單 \(#demo\)/);assert.match(sheet.innerHTML,/2030 年 12 月 27 日 13 時 30 分至 14 時 30 分/);
 for(const label of ['序號','姓名','性別','身分','活動收費情形','☑附近居民','150'])assert.ok(sheet.innerHTML.includes(label),label);
 assert.doesNotMatch(sheet.innerHTML,/（手寫姓名）/);assert.equal(canvases.length,1);assert.ok(canvases[0].commands.some(c=>c[0]==='lineTo'&&c[1]===400&&c[2]===140));
 blank.value='2';blank.oninput();assert.equal((sheet.innerHTML.match(/<tbody>/g)||[]).length,3);assert.equal(canvases.length,1);assert.ok(canvases[0].commands.some(c=>c[0]==='stroke'));
 printButton.onclick();assert.equal(calls.at(-1),'print');assert.match(note.textContent,/已帶入 1 位/);
});

test('報名頁輸出簽到單改讀報名名單，並標示不代表實際出席',async()=>{
 const calls=[],sheet={innerHTML:'',querySelectorAll:()=>[]},note={},blank={value:'0'},nodes={'#sheet':sheet,'#sheet-note':note,'#blank-rows':blank,'#print-sheet':{}};
 const data={session:{event_id:'demo',title:'報名名單',starts_at:'2030-12-27T05:30:00Z',ends_at:'2030-12-27T06:30:00Z',location:'社區教室',fee:'免費'},registrations:1,rows:[{full_name:'王小華',signature_json:null,age_group:'小',gender:'其他',identity:'其他',fee_snapshot:'免費'},{full_name:'',signature_json:null,age_group:'',gender:'',identity:'',fee_snapshot:'免費'}]};
 const context=vm.createContext({Intl,Date,Number,Math,Array,JSON,URLSearchParams,decodeURIComponent,location:{hash:'#demo',search:'?source=registrations'},document:{title:'',querySelector:s=>nodes[s]},api:async path=>{calls.push(path);return data;},esc,paintSignature,timeRange,siteConfig:async()=>({}),print(){}});
 await vm.runInContext(readFileSync(new URL('../public/admin/checkin-sheet.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 assert.equal(calls[0],'/api/admin/registrations/sheet?session_id=demo');
 for(const label of ['王小華','☑小','☑其他','☑其他','☑免費'])assert.ok(sheet.innerHTML.includes(label),label);
 assert.equal((sheet.innerHTML.match(/<tbody>/g)||[]).length,2);assert.match(note.textContent,/1 筆報名.*2 位參加者.*不代表實際出席/);
});

