// Applies site.config.json (served at /site-config.json) to elements marked with data-site="key" or "a.b".
// Pages keep neutral default text, so a failed fetch never leaves the page blank.
let loaded;
export const siteConfig=()=>loaded??=fetch('/site-config.json',{credentials:'same-origin'}).then(r=>r.ok?r.json():{}).catch(()=>({}));
const pick=(c,path)=>path.split('.').reduce((v,k)=>v&&typeof v==='object'?v[k]:undefined,c);
const safeURL=v=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
export async function applySite(root=document){
 const c=await siteConfig();
 for(const el of root.querySelectorAll('[data-site]')){const v=pick(c,el.dataset.site);if(typeof v==='string'&&v.trim())el.textContent=v;}
 if(c.brand){const page=document.title.trim();document.title=location.pathname==='/'||location.pathname==='/index.html'||!page?c.brand:`${page} · ${c.brand}`;}
 // Browser UI color: site.config.json themeColor if set, otherwise the active palette's deep color.
 const themeColor=/^#[0-9a-f]{6}$/i.test(c.themeColor||'')?c.themeColor:getComputedStyle(document.documentElement).getPropertyValue('--deep-blue').trim();if(themeColor)document.querySelector('meta[name="theme-color"]')?.setAttribute('content',themeColor);
 const desc=document.querySelector('meta[name="description"]');if(desc&&c.description&&location.pathname==='/')desc.content=c.description;
 const paragraphs=document.querySelector('#about-paragraphs');
 if(paragraphs&&Array.isArray(c.about?.paragraphs)&&c.about.paragraphs.length){paragraphs.replaceChildren(...c.about.paragraphs.filter(p=>typeof p==='string').map(t=>{const p=document.createElement('p');p.textContent=t;return p;}));}
 const contact=document.querySelector('#about-contact');if(contact&&c.about?.contact){contact.textContent='聯絡我們：'+c.about.contact;contact.hidden=false;}
 const links=document.querySelector('[data-site-links]');
 if(links){const list=(Array.isArray(c.links)?c.links:[]).map(l=>({...l,url:safeURL(l?.url)})).filter(l=>l.url&&l.label);
  links.hidden=!list.length;const holder=links.querySelector('[data-site-links-list]')||links;
  holder.replaceChildren(...list.map(l=>{const a=document.createElement('a');a.className='mascot-link website';a.href=l.url;a.target='_blank';a.rel='noopener noreferrer';
   a.innerHTML='<span class="mascot-link-icon" aria-hidden="true">↗</span><span><strong></strong><small></small></span><b aria-hidden="true">↗</b>';a.querySelector('strong').textContent=l.label;a.querySelector('small').textContent=l.note||'';return a;}));}
 return c;
}
if(!document.querySelector('script[data-site-manual]'))applySite();
