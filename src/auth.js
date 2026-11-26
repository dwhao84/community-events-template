import {fail,normalizeEmail,all,modules} from './lib.js';
const cache=new Map();
const decode = s => Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function verifyAccess(token,env,fetcher=fetch) {
 if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD) fail(503,'管理登入尚未設定');
 const domain=env.ACCESS_TEAM_DOMAIN.replace(/^https:\/\//,'').replace(/\/$/,'');
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) fail(503,'Access 網域設定錯誤');
 try {
  const parts=token.split('.');if(parts.length!==3) throw Error();
  const h=JSON.parse(new TextDecoder().decode(decode(parts[0])));const p=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(h.alg!=='RS256'||typeof h.kid!=='string'||p.iss!==`https://${domain}`||!Array.isArray(p.aud)||!p.aud.includes(env.ACCESS_AUD)||!Number.isFinite(p.exp)||p.exp<=Date.now()/1000||p.nbf&&p.nbf>Date.now()/1000||!p.email) throw Error();
  let c=cache.get(domain);
  if(!c||c.until<Date.now()||!c.keys.some(k=>k.kid===h.kid)) {const res=await fetcher(`https://${domain}/cdn-cgi/access/certs`);if(!res.ok)throw Error();c={keys:(await res.json()).keys,until:Date.now()+300000};cache.set(domain,c);}
  const jwk=c.keys.find(k=>k.kid===h.kid);if(!jwk)throw Error();
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts.slice(0,2).join('.'))))throw Error();
  return normalizeEmail(p.email);
 } catch {fail(401,'請透過管理登入重新驗證身分');}
}
export async function authenticate(req,env) {
 const host=new URL(req.url).hostname;
 if(env.APP_ENV==='development'&&['localhost','127.0.0.1','[::1]'].includes(host)&&env.LOCAL_ADMIN_TOKEN&&req.headers.get('authorization')===`Bearer ${env.LOCAL_ADMIN_TOKEN}`) return {email:'local@community-events.test',permissions:modules,local:true};
 const email=await verifyAccess(req.headers.get('cf-access-jwt-assertion')||'',env);
 let permissions=(await all(env.DB,'SELECT module FROM admin_permissions WHERE email=?',email)).map(r=>r.module);
 if(!permissions.length&&await bootstrapAdmin(env,email))permissions=[...modules];
 if(!permissions.length) fail(403,'尚未授予管理權限');return {email,permissions,local:false};
}
// First run only: while admin_permissions is empty, the Access-verified ADMIN_BOOTSTRAP_EMAIL becomes the first admin.
// Each INSERT re-checks that no other admin exists, so concurrent first logins cannot both win.
export async function bootstrapAdmin(env,email){
 const target=normalizeEmail(env.ADMIN_BOOTSTRAP_EMAIL);if(!target||target!==email)return false;
 if(await env.DB.prepare('SELECT 1 FROM admin_permissions LIMIT 1').first())return false;
 await env.DB.batch([...modules.map(m=>env.DB.prepare('INSERT OR IGNORE INTO admin_permissions(email,module) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM admin_permissions WHERE email<>?)').bind(email,m,email)),env.DB.prepare("INSERT INTO audit_logs SELECT ?,?,'admin.bootstrap',?,'{}',? WHERE EXISTS (SELECT 1 FROM admin_permissions WHERE email=?)").bind(crypto.randomUUID(),email,email,new Date().toISOString(),email)]);
 return !!(await env.DB.prepare("SELECT 1 FROM admin_permissions WHERE email=? AND module='admins'").bind(email).first());
}
export function authorize(admin,module,cfg={}) {
 if(!admin.permissions.includes(module)) fail(403,'權限不足');
 if(module!=='admins' && cfg.modules && cfg.modules[module]===false) fail(403,'此模組已停用');
}
