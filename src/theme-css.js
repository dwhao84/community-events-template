// Builds the site color CSS for a preset or a custom palette. styles.css refers to its blue / green shades as
// var(--c-<hex>); src/theme-shades.json (made by scripts/themes.mjs) records how each shade derives from the default
// brand or button color, so any palette can rebuild the same light / dark steps.
import shades from './theme-shades.json' with {type:'json'};
import {themes,themeFor} from './themes.js';

const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
export const toHex=c=>'#'+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
export const mix=(a,b,p)=>toHex(rgb(a).map((v,i)=>v*p+rgb(b)[i]*(1-p)));
const lum=h=>{const [r,g,b]=rgb(h).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
export const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
export const isHex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
export const paletteKeys=['brand','deep','action','ink','accent'];

// Readability rules: white text on buttons and on headings-colored blocks, body text on the page background.
export function contrastReport(p){
 const page=mix(p.accent,'#ffffff',.08);
 return {button:contrast(p.action,'#ffffff'),heading:contrast(p.deep,'#ffffff'),text:contrast(p.ink,page),link:contrast(p.brand,'#ffffff')};
}
export const minimums={button:4.5,heading:4.5,text:7,link:3};
export function paletteProblems(p){
 const r=contrastReport(p),labels={button:'按鈕色與白字',heading:'深色標題與白底',text:'內文色與頁面底色',link:'主色與白底'};
 return Object.entries(minimums).filter(([k,min])=>r[k]<min).map(([k,min])=>`${labels[k]}對比 ${r[k].toFixed(2)}，至少需要 ${min}`);
}
// Saved value: a preset id, or {id:'custom', brand, deep, action, ink, accent}.
export function resolvePalette(saved){
 if(saved&&typeof saved==='object'&&saved.id==='custom'&&paletteKeys.every(k=>isHex(saved[k])))return {id:'custom',name:'自訂',...Object.fromEntries(paletteKeys.map(k=>[k,saved[k].toLowerCase()]))};
 return themeFor(typeof saved==='string'?saved:undefined);
}
export function paletteVars(p){
 const vars={'--blue':p.brand,'--deep-blue':p.deep,'--green':p.action,'--ink':p.ink,'--muted':mix(p.ink,'#ffffff',.72),'--line':mix(p.brand,'#ffffff',.22),'--sky':mix(p.brand,'#ffffff',.13),'--cream':mix(p.accent,'#ffffff',.08),'--yellow':p.accent};
 for(const s of shades)vars[`--c-${s.hex}`]=mix(p[s.family],s.anchor,s.p);
 return vars;
}
// The default theme maps every shade to its original hex so the stock look never changes.
// ':root:root' outranks the plain :root blocks in styles.css, which load after this @import.
export function themeCSS(saved,selector=':root:root'){
 const p=resolvePalette(saved);
 const vars=p.id===themes[0].id?Object.fromEntries(shades.map(s=>[`--c-${s.hex}`,'#'+s.hex])):paletteVars(p);
 return `/* site colors: ${p.id} */\n${selector}{${Object.entries(vars).map(([k,v])=>`${k}:${v}`).join(';')}}\n`;
}
