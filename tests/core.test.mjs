import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpError, reminderAt, validateAnswers, validateFields, csvCell, normalizeEmail} from '../src/lib.js';
import {renderTemplate, validateTemplate} from '../src/mail.js';
import {imageInfo} from '../src/photos.js';

const fields=[
  {id:'name',type:'text',label:'稱呼',required:false,enabled:true},
  {id:'email',type:'text',label:'Email',required:true,enabled:true},
  {id:'participant_count',type:'number',label:'參加人數',required:true,enabled:true,min:1,max:100000},
];

test('團體報名支援超過 20 人',()=>{
  validateFields(fields);
  const result=validateAnswers(fields,{name:'里民',email:' USER+group@example.com ',participant_count:35});
  assert.equal(result.participant_count,35);
  assert.equal(result.email,'user+group@example.com');
  assert.equal(normalizeEmail(' A.B+tag@Example.COM '),'a.b+tag@example.com');
});

test('團體報名仍受表單設定上限約束',()=>{
  assert.throws(()=>validateAnswers(fields,{email:'a@example.com',participant_count:100001}),e=>e instanceof HttpError&&e.status===400);
});

test('台灣時間前一天 09:00 轉為 UTC',()=>{
  assert.equal(reminderAt('2026-10-17T05:30:00.000Z','09:00'),'2026-10-16T01:00:00.000Z');
});

test('CSV 匯出避免試算表公式注入',()=>{
  assert.equal(csvCell('=IMPORTXML("x")'),'"\'=IMPORTXML(""x"")"');
});

test('通知變數會轉義 HTML 且拒絕未知變數',()=>{
  validateTemplate('活動 {{event_name}}','{{name}}，共 {{seats}} 位');
  const out=renderTemplate({subject:'活動 {{event_name}}',body:'{{name}}'},{event_name:'防詐',name:'<script>alert(1)</script>'});
  assert.match(out.html,/&lt;script&gt;/);
  assert.doesNotMatch(out.html,/<script>/);
  assert.throws(()=>validateTemplate('測試 {{secret}}','內容'),HttpError);
});

test('只接受結構正確的 PNG/JPEG/WebP',()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,10,0,0,0,20]);
  assert.deepEqual(imageInfo(png),{mime:'image/png',width:10,height:20});
  assert.throws(()=>imageInfo(Uint8Array.from([1,2,3])),HttpError);
});
