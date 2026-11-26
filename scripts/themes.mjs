// Records how each var(--c-<hex>) shade in public/styles.css derives from the default theme, into src/theme-shades.json,
// and checks every preset in src/themes.js for readable contrast. The Worker builds /theme.css from both at runtime.
// Usage: node scripts/themes.mjs          (write src/theme-shades.json)
//        node scripts/themes.mjs --check  (exit 1 if the file is stale or a preset fails contrast)
import {readFileSync,writeFileSync} from 'node:fs';
import {themes} from '../src/themes.js';

const root=new URL('..',import.meta.url);
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function hue(h){const [r,g,b]=rgb(h).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return 0;let x=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;x*=60;return x<0?x+360:x;}
// Best p and anchor (white or black) so that mix(base, anchor, p) ≈ target, least squares in sRGB.
function fit(base,target){
 const b=rgb(base),t=rgb(target);let best;
 for(const anchor of ['#ffffff','#000000']){
  const a=rgb(anchor),d=b.map((v,i)=>v-a[i]),num=t.reduce((s,v,i)=>s+(v-a[i])*d[i],0),den=d.reduce((s,v)=>s+v*v,0);
  const p=Math.max(0,Math.min(1,num/den)),err=b.reduce((s,v,i)=>s+(v*p+a[i]*(1-p)-t[i])**2,0);
  if(!best||err<best.err)best={anchor,p:Math.round(p*1000)/1000,err};
 }
 return best;
}
export function plan(){
 const css=readFileSync(new URL('public/styles.css',root),'utf8');
 const hexes=[...new Set([...css.matchAll(/var\(--c-([0-9a-f]{6})\)/g)].map(m=>m[1]))].sort();
 // Blue-ish shades follow the brand color; green-ish shades follow the button (action) color.
 return hexes.map(hex=>{const family=hue('#'+hex)>=115&&hue('#'+hex)<=165?'action':'brand';const {anchor,p}=fit(themes[0][family],'#'+hex);return {hex,family,anchor,p};});
}
if(import.meta.url===`file://${process.argv[1]}`){
 const target=new URL('src/theme-shades.json',root),json=JSON.stringify(plan(),null,0).replaceAll('},{','},\n{')+'\n';
 if(process.argv.includes('--check')){let cur='';try{cur=readFileSync(target,'utf8');}catch{}if(cur!==json){console.error('src/theme-shades.json 過期，請執行 node scripts/themes.mjs');process.exit(1);}}
 else writeFileSync(target,json);
 const {contrastReport,paletteProblems}=await import('../src/theme-css.js');
 let bad=false;
 for(const t of themes){const r=contrastReport(t),problems=paletteProblems(t);bad||=problems.length>0;console.log(`${t.id.padEnd(9)} 按鈕 ${r.button.toFixed(2)}  標題 ${r.heading.toFixed(2)}  內文 ${r.text.toFixed(2)}  主色 ${r.link.toFixed(2)}${problems.length?'  ✗ '+problems.join('；'):''}`);}
 if(bad)process.exit(1);
 console.log(process.argv.includes('--check')?'theme shades: ok':'wrote src/theme-shades.json');
}
