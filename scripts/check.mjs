import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root=new URL('..',import.meta.url).pathname;
const node=process.execPath;
execFileSync(node,[join(root,'scripts','config-check.mjs')],{stdio:'inherit'});
function files(dir){return readdirSync(join(root,dir)).flatMap(name=>{const path=join(root,dir,name);return statSync(path).isDirectory()?[]:[path];});}
for(const file of [...files('src'),...files('scripts'),...files('public'),...files('public/admin')].filter(x=>/\.m?js$/.test(x)))execFileSync(node,['--check',file],{stdio:'inherit'});
execFileSync(node,[join(root,'scripts','themes.mjs'),'--check'],{stdio:'inherit'});
execFileSync(node,['--test',...readdirSync(join(root,'tests')).filter(name=>name.endsWith('.test.mjs')).map(name=>join(root,'tests',name))],{stdio:'inherit'});

const temp=mkdtempSync(join(tmpdir(),'community-events-'));
const db=join(temp,'test.sqlite');
try{
  for(const migration of readdirSync(join(root,'migrations')).filter(name=>name.endsWith('.sql')).sort()){
    execFileSync('sqlite3',[db,'.read '+join(root,'migrations',migration)],{stdio:'inherit'});
  }
  const sql=`
    UPDATE settings SET value='true' WHERE key='operating_ready';
    INSERT INTO events(id,title,status,default_form_id,contact,created_at,updated_at) VALUES('anti-fraud','測試活動','published','anti-fraud-v1','organizer@example.com','2026-10-04T00:00:00.000Z','2026-10-04T00:00:00.000Z');
    INSERT INTO form_versions VALUES('anti-fraud-v1','anti-fraud',1,'published','[]','2026-10-04T00:00:00.000Z');
    INSERT INTO event_sessions(id,event_id,starts_at,ends_at,location,capacity,fee,status,registration_open,max_seats_per_registration,reminder_at,created_at,updated_at) VALUES('anti-fraud-20261017','anti-fraud','2026-10-17T05:30:00.000Z','2026-10-17T07:00:00.000Z','社區活動中心',50,'免費','published',1,100,'2026-10-16T01:00:00.000Z','2026-10-04T00:00:00.000Z','2026-10-04T00:00:00.000Z');
    INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,status,seats,answers_json,consent_at,consent_version,consent_json,submission_id,created_at,updated_at)
      VALUES('r1','anti-fraud-20261017','DN-R1','團體甲','a@example.com','a@example.com','anti-fraud-v1','pending',30,'{}','2026-10-04T01:00:00.000Z','v1','{}','s1','2026-10-04T01:00:00.000Z','2026-10-04T01:00:00.000Z');
    SELECT COALESCE(SUM(seats),0) FROM registrations WHERE status IN('pending','confirmed');
  `;
  const out=execFileSync('sqlite3',[db,sql],{encoding:'utf8'}).trim();
  if(out!=='30')throw Error('名額計算驗證失敗');
  let rejected=false;
  try{execFileSync('sqlite3',[db,`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,status,seats,answers_json,consent_at,consent_version,consent_json,submission_id,created_at,updated_at) VALUES('r2','anti-fraud-20261017','DN-R2','團體乙','b@example.com','b@example.com','anti-fraud-v1','pending',21,'{}','2026-10-04T01:01:00.000Z','v1','{}','s2','2026-10-04T01:01:00.000Z','2026-10-04T01:01:00.000Z');`],{stdio:'pipe'});}catch{rejected=true;}
  if(!rejected)throw Error('超收防護未拒絕超額寫入');
  let limited=false;
  execFileSync('sqlite3',[db,`UPDATE event_sessions SET max_seats_per_registration=5 WHERE id='anti-fraud-20261017';`]);
  try{execFileSync('sqlite3',[db,`INSERT INTO registrations(id,session_id,code,name,email,normalized_email,form_id,status,seats,answers_json,consent_at,consent_version,consent_json,submission_id,created_at,updated_at) VALUES('r3','anti-fraud-20261017','DN-R3','團體丙','c@example.com','c@example.com','anti-fraud-v1','pending',6,'{}','2026-10-04T01:02:00.000Z','v1','{}','s3','2026-10-04T01:02:00.000Z','2026-10-04T01:02:00.000Z');`],{stdio:'pipe'});}catch{limited=true;}
  if(!limited)throw Error('每筆人數上限未拒絕超額報名');
  console.log('SQLite migrations, capacity and seat-limit triggers: ok');
}finally{rmSync(temp,{recursive:true,force:true});}
