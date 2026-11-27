// Renders block pages (About, the organizer-defined page) from their public API. Text is always set with textContent;
// links are limited to https:, /, mailto: and tel: by the server and checked again here.
export const el=(tag,attrs={},text)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs))if(v!==undefined&&v!==null&&v!=='')n.setAttribute(k,v);if(text)n.textContent=text;return n;};
const safeHref=v=>typeof v==='string'&&/^(https:\/\/|\/(?!\/)|mailto:|tel:)/.test(v)?v:null;
const paragraphs=body=>String(body||'').split(/\n\s*\n/).filter(p=>p.trim()).map(p=>el('p',{},p.trim()));
export function renderBlock(b,first){
 const section=el('section',{class:`about-block tone-${['plain','tinted','accent'].includes(b.tone)?b.tone:'plain'} align-${b.align==='center'?'center':'left'}`});
 const heading=(text,level='h2')=>text?section.append(el(level,{},text)):null;
 if(b.type==='hero'){heading(b.title,first?'h1':'h2');if(b.text)section.append(...paragraphs(b.text));}
 else if(b.type==='text'||b.type==='contact'){heading(b.heading);section.append(...paragraphs(b.body));}
 else if(b.type==='cards'){heading(b.heading);const grid=el('div',{class:`about-cards cols-${[2,3,4].includes(b.columns)?b.columns:3}`});for(const i of b.items||[]){const card=el('article');if(i.title)card.append(el('h3',{},i.title));if(i.text)card.append(...paragraphs(i.text));grid.append(card);}section.append(grid);}
 else if(b.type==='image_text'){const wrap=el('div',{class:`about-image-text image-${b.image_side==='right'?'right':'left'}`});const fig=el('figure',{class:'about-figure'});
  fig.append(el('img',{src:`/media/${encodeURIComponent(b.image_id)}`,alt:b.alt||'',width:b.width,height:b.height,loading:'lazy',decoding:'async'}));
  const copy=el('div');if(b.heading)copy.append(el('h2',{},b.heading));copy.append(...paragraphs(b.body));wrap.append(fig,copy);section.append(wrap);}
 else if(b.type==='links'){heading(b.heading);const list=el('div',{class:'about-links'});for(const i of b.items||[]){const href=safeHref(i.url);if(!href)continue;const external=href.startsWith('https://');const a=el('a',{href,...(external?{target:'_blank',rel:'noopener noreferrer'}:{})},`${i.label}${external?' ↗':''}`);if(i.note)a.append(el('small',{},i.note));list.append(a);}section.append(list);}
 else return null;
 return section;
}
// Replaces the static fallback in root with the saved blocks; keeps the fallback when the API fails.
export async function loadBlocks(root,url,title){
 try{const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)return null;const data=await r.json(),{blocks}=data;
  const nodes=(Array.isArray(blocks)?blocks:[]).map((b,i)=>renderBlock(b,i===0)).filter(Boolean);
  if(nodes.length){root.classList.add('about-blocks');root.replaceChildren(...nodes);if(!root.querySelector('h1')){const h=el('h1',{class:'sr-only'},title);root.prepend(h);}}
  return data;
 }catch{return null;/* keep the default content */}
}
