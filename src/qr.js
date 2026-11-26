import qrcode from './vendor/qrcode-generator.js';

// The QR holds only the registration code; mail embeds the PNG as a CID attachment because webmail strips data: images.
export const QR_CONTENT_ID='checkin-qr';
export function qrModules(value) {
 const qr=qrcode(0,'M');qr.addData(String(value),'Byte');qr.make();
 const n=qr.getModuleCount();return Array.from({length:n},(_,y)=>Array.from({length:n},(_,x)=>qr.isDark(y,x)));
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){
 const out=new Uint8Array(12+data.length),view=new DataView(out.buffer);
 view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);view.setUint32(8+data.length,crc32(out.subarray(4,8+data.length)));return out;
}
// 1-bit grayscale PNG with a 4-module quiet zone; a set bit is white.
export async function qrPng(value,{scale=8,margin=4}={}) {
 const modules=qrModules(value),size=(modules.length+margin*2)*scale,stride=1+Math.ceil(size/8),raw=new Uint8Array(stride*size);
 for(let y=0;y<size;y++){const row=modules[Math.floor(y/scale)-margin];for(let x=0;x<size;x++)if(!row?.[Math.floor(x/scale)-margin])raw[y*stride+1+(x>>3)]|=0x80>>(x&7);}
 const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,size);view.setUint32(4,size);header[8]=1;
 const idat=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',idat),chunk('IEND',new Uint8Array())];
 const png=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){png.set(p,offset);offset+=p.length;}
 return {png,size};
}
export async function qrAttachment(code) {
 const {png}=await qrPng(code);let binary='';for(const b of png)binary+=String.fromCharCode(b);
 return {filename:'checkin-qr.png',content:btoa(binary),content_type:'image/png',content_id:QR_CONTENT_ID};
}
