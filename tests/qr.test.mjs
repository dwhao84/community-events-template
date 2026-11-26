import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {qrPng,qrAttachment} from '../src/qr.js';

globalThis.self??=globalThis;
await import('../public/admin/vendor/jsQR.js');

function chunks(png){const out={},view=new DataView(png.buffer,png.byteOffset);for(let i=8;i<png.length;){const length=view.getUint32(i),type=new TextDecoder().decode(png.subarray(i+4,i+8));out[type]=png.subarray(i+8,i+8+length);i+=12+length;}return out;}

test('報到 QR Code 產生有效 PNG，且後台解碼器可讀回報名編號',async()=>{
 const {png,size}=await qrPng('DN-1A2B3C4D');
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const {IHDR,IDAT}=chunks(png),view=new DataView(IHDR.buffer,IHDR.byteOffset);
 assert.equal(view.getUint32(0),size);assert.equal(view.getUint32(4),size);
 const raw=inflateSync(IDAT),stride=1+Math.ceil(size/8),rgba=new Uint8ClampedArray(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const v=raw[y*stride+1+(x>>3)]&(0x80>>(x&7))?255:0;rgba.set([v,v,v,255],(y*size+x)*4);}
 assert.equal(self.jsQR(rgba,size,size)?.data,'DN-1A2B3C4D');
});

test('QR 附件以 CID 內嵌，內容僅為 base64 PNG',async()=>{
 const attachment=await qrAttachment('DN-1A2B3C4D');
 assert.equal(attachment.content_id,'checkin-qr');
 assert.equal(attachment.content_type,'image/png');
 assert.match(attachment.content,/^iVBORw0KGgo[A-Za-z0-9+/=]+$/);
});
