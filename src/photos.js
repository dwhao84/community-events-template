import {fail,uid,stmt,one,run,audit,readLimited,text,nowISO} from './lib.js';
export function imageInfo(bytes) {
 const b=bytes, d=new DataView(b.buffer,b.byteOffset,b.byteLength);let width,height,mime;
 if(b.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)&&new TextDecoder().decode(b.slice(12,16))==='IHDR'){mime='image/png';width=d.getUint32(16);height=d.getUint32(20);}
 else if(b.length>=12&&b[0]===255&&b[1]===216) {
  let i=2;while(i<b.length){if(b[i++]!==255)break;while(b[i]===255)i++;const marker=b[i++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
   if(i+2>b.length)break;const len=d.getUint16(i);if(len<2||i+len>b.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&len>=8){mime='image/jpeg';height=d.getUint16(i+3);width=d.getUint16(i+5);break;}i+=len;
  }
 } else if(b.length>=30&&new TextDecoder().decode(b.slice(0,4))==='RIFF'&&new TextDecoder().decode(b.slice(8,12))==='WEBP') {
  const type=new TextDecoder().decode(b.slice(12,16));mime='image/webp';
  if(type==='VP8X'){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
  else if(type==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=d.getUint16(26,true)&16383;height=d.getUint16(28,true)&16383;}
  else if(type==='VP8L'&&b[20]===47){width=1+((b[22]&63)<<8|b[21]);height=1+((b[24]&15)<<10|b[23]<<2|b[22]>>6);}
 }
 if(!mime||!width||!height)fail(400,'僅接受有效 JPG、PNG 或 WebP 圖片');return {mime,width,height};
}
export async function uploadPhoto(req,env,admin,url) {
 const bytes=await readLimited(req,Number(env.MAX_PHOTO_BYTES||8388608));const info=imageInfo(bytes);const max=Number(env.MAX_PHOTO_DIMENSION||6000);
 if(info.width>max||info.height>max)fail(400,`圖片尺寸不得超過 ${max}px`);
 const eventId=url.searchParams.get('event_id');const sessionId=url.searchParams.get('session_id')||null;
 if(!await one(env.DB,'SELECT id FROM events WHERE id=?',eventId))fail(404,'找不到活動');
 if(sessionId&&!await one(env.DB,'SELECT id FROM event_sessions WHERE id=? AND event_id=?',sessionId,eventId))fail(400,'場次不屬於此活動');
 const id=uid(),key=`photos/${eventId}/${id}`,now=nowISO();await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:info.mime}});
 try{await env.DB.batch([stmt(env.DB,'INSERT INTO event_photos(id,event_id,session_id,object_key,mime,size,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,eventId,sessionId,key,info.mime,bytes.length,info.width,info.height,now),audit(env.DB,admin.email,'photo.upload',id)]);}catch(e){await env.PHOTOS.delete(key);throw e;}
 return {id,...info};
}
export async function thumbnail(req,env,admin,id){
 const p=await one(env.DB,'SELECT * FROM event_photos WHERE id=?',id);if(!p)fail(404,'照片不存在');
 const bytes=await readLimited(req,262144);const info=imageInfo(bytes);if(info.width>800||info.height>800)fail(400,'縮圖最多 800px');
 const key=`${p.object_key}/thumbnail`;await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:info.mime}});
 await env.DB.batch([stmt(env.DB,'UPDATE event_photos SET thumbnail_key=? WHERE id=?',key,id),audit(env.DB,admin.email,'photo.thumbnail',id)]);return {ok:true};
}
export async function updatePhoto(b,env,admin,id){
 const p=await one(env.DB,'SELECT * FROM event_photos WHERE id=?',id);if(!p)fail(404,'照片不存在');
 const status=b.status??p.status;if(!['published','hidden','removed'].includes(status))fail(400,'照片狀態錯誤');const order=b.sort_order??p.sort_order;if(!Number.isInteger(order)||order<0||order>100000)fail(400,'排序錯誤');
 if(status==='published'&&!p.thumbnail_key)fail(400,'請先產生縮圖再發布');
 const statements=[stmt(env.DB,'UPDATE event_photos SET caption=?,sort_order=?,status=? WHERE id=?',text(b.caption??p.caption,500),order,status,id)];
 if(b.cover==='event')statements.push(stmt(env.DB,'UPDATE events SET cover_photo_id=? WHERE id=?',id,p.event_id));
 if(b.cover==='session'){if(!p.session_id)fail(400,'此照片未指定場次');statements.push(stmt(env.DB,'UPDATE event_sessions SET cover_photo_id=? WHERE id=?',id,p.session_id));}
 statements.push(audit(env.DB,admin.email,'photo.update',id,{status,order,cover:b.cover||null}));await env.DB.batch(statements);return {ok:true};
}
export async function media(req,env,id,admin=false) {
 const p=await one(env.DB,admin?'SELECT * FROM event_photos WHERE id=?':`SELECT p.* FROM event_photos p JOIN events e ON e.id=p.event_id LEFT JOIN event_sessions s ON s.id=p.session_id WHERE p.id=? AND p.status='published' AND e.status='published' AND (p.session_id IS NULL OR s.status='published')`,id);
 if(!p||p.status==='removed'&&!admin)fail(404,'照片不存在');const key=new URL(req.url).searchParams.has('thumb')&&p.thumbnail_key?p.thumbnail_key:p.object_key;
 const object=await env.PHOTOS.get(key);if(!object)fail(404,'檔案不存在');
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||p.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
