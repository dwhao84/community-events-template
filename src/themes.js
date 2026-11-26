// Site color themes. `brand` drives tints, headings and links; `action` is the button color (white text);
// `ink` is body text; `accent` is the highlight (badges, hero dots). scripts/themes.mjs turns these into public/themes.css
// and checks contrast. The first theme is the default and keeps the original stylesheet colors exactly.
export const themes=[
 {id:'ocean',name:'海洋藍',brand:'#0769c8',deep:'#074a98',action:'#067a3a',ink:'#123c72',accent:'#ffd43b'},
 {id:'forest',name:'森林綠',brand:'#2f855a',deep:'#1c4532',action:'#276749',ink:'#1c3d2e',accent:'#f6c344'},
 {id:'teal',name:'湖水青',brand:'#0f8a8a',deep:'#134e4a',action:'#0f766e',ink:'#123b3a',accent:'#fcd34d'},
 {id:'sunset',name:'暖陽橘',brand:'#dd6b20',deep:'#7b341e',action:'#b45309',ink:'#4a2511',accent:'#fde68a'},
 {id:'sakura',name:'櫻花粉',brand:'#d53f8c',deep:'#702459',action:'#b83280',ink:'#521b41',accent:'#fbd38d'},
 {id:'lavender',name:'薰衣草紫',brand:'#6b46c1',deep:'#44337a',action:'#553c9a',ink:'#322659',accent:'#f6e05e'},
 {id:'brick',name:'磚紅',brand:'#c0392b',deep:'#7f1d1d',action:'#a93226',ink:'#4a1c17',accent:'#f9d56e'},
 {id:'earth',name:'大地棕',brand:'#8b5e34',deep:'#4a3222',action:'#5a6e1e',ink:'#3b2a1e',accent:'#e9c46a'},
 {id:'night',name:'夜空藍',brand:'#3b5bdb',deep:'#1e2a78',action:'#364fc7',ink:'#1b2140',accent:'#ffd43b'},
 {id:'graphite',name:'沉穩灰',brand:'#4a5568',deep:'#1a202c',action:'#2d3748',ink:'#1a202c',accent:'#ecc94b'}
];
export const themeIds=themes.map(t=>t.id);
export const defaultTheme=themes[0].id;
export const themeFor=id=>themes.find(t=>t.id===id)||themes[0];
