// 開站問卷：每一關要問主辦方的題目。AI 助理依這份清單發問（npm run setup -- next），答案存在 .local/setup-answers.json（不提交）。
// 欄位：key、ask（白話問題）、example、default（沒回答或回「用預設」時的值，可依其他答案產生）、quick（快速開站也要問）、
//       optional（可以跳過、不套用）、private（個資，只留在本機答案檔）、validate（回傳錯誤訊息，空字串代表通過）、
//       write（套用到哪裡：site／wrangler／draft）。秘密一律不在這裡，只提示對方自己在終端機輸入。
import {themes,themeIds} from '../src/themes.js';

const graphemes=v=>[...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(v)].length;
const email=v=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const nonEmpty=(max,label)=>v=>typeof v!=='string'||!v.trim()?`${label}不可空白`:v.length>max?`${label}最多 ${max} 字`:'';
const optText=max=>v=>typeof v!=='string'?'請用文字回答':v.length>max?`最多 ${max} 字`:'';
const list=(max,label,each)=>v=>!Array.isArray(v)?`${label}請用清單回答`:v.length>max?`${label}最多 ${max} 項`:v.map(each).find(Boolean)||'';
const domain=v=>/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)&&!/^https?:/i.test(v);
const community=a=>a.communityName||'（社區名稱）';

export const stages=[
 {id:'content',stage:3,title:'社區與網站內容',questions:[
  {key:'communityName',ask:'社區名稱是什麼？',example:'幸福社宅',quick:true,validate:nonEmpty(40,'社區名稱'),write:'site'},
  {key:'brand',ask:'網站要叫什麼名字？（會出現在頁首、信件與瀏覽器分頁）',example:'幸福社區活動',default:a=>`${community(a)}活動報名`,quick:true,validate:nonEmpty(30,'網站名稱'),write:'site'},
  {key:'englishBrand',ask:'網站英文名稱？',example:'Happy Community Events',default:'Community Events',validate:nonEmpty(40,'英文名稱'),write:'site'},
  {key:'brandMark',ask:'標誌字（一個字，顯示在網站左上角的方塊裡）？',example:'幸',default:a=>[...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment((a.brand||`${community(a)}活動報名`).trim())][0]?.segment||'社',validate:v=>typeof v!=='string'||graphemes(v.trim())!==1?'標誌字只能是 1 個字':'',write:'site'},
  {key:'tagline',ask:'一句話標語？',example:'社區生活，從參與開始。',default:'社區生活，從參與開始。',validate:optText(60),write:'site'},
  {key:'description',ask:'網站簡介（給搜尋引擎看的一句話）？',example:'幸福社宅的活動資訊與線上報名。',default:a=>`${community(a)}的活動資訊與線上報名。`,validate:optText(160),write:'site'},
  {key:'theme',ask:`網站配色要哪一個？${themes.map(t=>`${t.name}（${t.id}）`).join('、')}`,example:'forest',default:themeIds[0],validate:v=>themeIds.includes(v)?'':`請從 ${themeIds.join('、')} 選一個`,write:'site'},
  {key:'heroTitle',ask:'首頁活動區的大標題？',example:'一起參加社區活動',default:'一起參加社區活動',validate:optText(40),write:'site'},
  {key:'heroText',ask:'首頁活動區的說明？',example:'找到適合的場次，和鄰居一起來參與。',default:'找到適合的場次，和鄰居一起來參與。',validate:optText(120),write:'site'},
  {key:'links',ask:'有沒有要放的對外連結？（例如社區網站、LINE 社群；每個要名稱、網址、一句說明，沒有就回「沒有」）',example:[{label:'LINE 社群',url:'https://line.me/ti/g2/xxxx',note:'加入社區討論區'}],default:[],validate:list(8,'連結',l=>!l||typeof l.label!=='string'||!l.label.trim()?'每個連結都要有名稱':!/^https:\/\/\S+$/.test(l.url||'')?`「${l.label}」的網址必須是 https:// 開頭`:''),write:'site'},
  {key:'identities',ask:'報名表的「參加者身分」選項有哪些？（每個最多 50 字）',example:['社區住戶','附近居民','其他'],default:['社區住戶','附近居民','其他'],validate:v=>list(20,'身分選項',x=>typeof x!=='string'||!x.trim()||x.length>50?'每個身分選項須為 1–50 字':'')(v)||(new Set(v.map(x=>x.trim())).size!==v.length?'身分選項有重複':''),write:'site'},
  {key:'aboutTitle',ask:'「關於我們」頁的標題？（之後也能在後台改）',example:'關於我們',default:'關於我們',validate:nonEmpty(40,'標題'),write:'site'},
  {key:'aboutParagraphs',ask:'「關於我們」的介紹？（可以多段）',example:['我們是幸福社宅的活動團隊，定期舉辦講座、課程與交流活動。'],default:a=>[`我們是${community(a)}的活動團隊，定期舉辦講座、課程與交流活動。`,'歡迎鄰居報名參加，也歡迎提出想參加的活動主題。'],validate:list(10,'介紹',p=>typeof p!=='string'||!p.trim()||p.length>1000?'每段介紹須為 1–1000 字':''),write:'site'},
  {key:'aboutContact',ask:'「關於我們」要放的聯絡方式？（會公開在網站上；沒有就回「沒有」）',example:'社區管理中心 02-1234-5678',default:'',validate:optText(200),write:'site'},
  {key:'emailSignoff',ask:'通知信的署名？',example:'幸福社區活動小組',default:a=>`${community(a)}活動團隊`,validate:nonEmpty(40,'署名'),write:'site'},
  {key:'feedbackOrganizer',ask:'課程回饋信上的主辦單位名稱？',example:'幸福社宅｜社區共學活動',default:a=>`${community(a)}｜社區活動`,validate:nonEmpty(60,'主辦單位名稱'),write:'site'}
 ]},
 {id:'deploy',stage:5,title:'網址與管理員',questions:[
  {key:'workerName',ask:'網站程式名稱（英文小寫、數字和 -，也會成為免費網址的一部分）？',example:'happy-events',quick:true,validate:v=>typeof v==='string'&&/^[a-z0-9](?:[a-z0-9-]{0,52}[a-z0-9])?$/.test(v)?'':'只能用英文小寫、數字與 -，不可用 - 開頭或結尾，最長 54 字',write:'wrangler'},
  {key:'adminEmail',ask:'第一位管理員的 Email？（用來登入後台，第一次登入時要能立刻收信；只存在這台電腦）',example:'organizer@example.org',quick:true,private:true,validate:v=>typeof v==='string'&&email(v)?'':'Email 格式不對',write:'secret'},
  {key:'customDomain',ask:'要用自己的網域嗎？（例如 events.example.org，網域須已交給 Cloudflare 管理；沒有就回「沒有」，先用免費網址）',example:'events.example.org',optional:true,default:'',validate:v=>v===''||typeof v==='string'&&domain(v)?'':'請只填網域，例如 events.example.org（不要加 https:// 或 /）',write:'wrangler'}
 ]},
 {id:'login',stage:6,title:'後台登入（Cloudflare Access）',after:'對方在 Cloudflare 儀表板建好 Access 應用程式之後再問（docs/manual-handoffs.md C1）',questions:[
  {key:'accessTeamDomain',ask:'Access 的團隊網域？（Zero Trust → Settings → Custom Pages，形如 xxx.cloudflareaccess.com）',example:'happy.cloudflareaccess.com',optional:true,validate:v=>typeof v==='string'&&/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(v.replace(/^https:\/\//,'').replace(/\/$/,''))?'':'格式應為 <團隊名稱>.cloudflareaccess.com',write:'wrangler'},
  {key:'accessAud',ask:'Access 應用程式的 Application Audience (AUD) Tag？（應用程式 Overview 頁，64 個英數字）',example:'4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2',optional:true,validate:v=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v)?'':'應為 64 個十六進位字元',write:'wrangler'}
 ]},
 {id:'protect',stage:6,title:'報名防護（Turnstile）',after:'先執行 npm run setup:turnstile；API 權限不足、需要從儀表板複製時才問 Site Key',questions:[
  {key:'turnstileSiteKey',ask:'Turnstile 的 Site Key？（公開值，可以貼在對話；Secret Key 不要貼）',example:'0x4AAAAAAA…',optional:true,validate:v=>typeof v==='string'&&/^[0-9A-Za-z_-]{10,100}$/.test(v)&&!/^[12]x0{10,}/.test(v)?'':'格式不對（應為 0x4AAAA… 這種格式，不是 Secret Key，也不能是 1x0000… 測試鍵）',write:'turnstile'}
 ]},
 {id:'optional',stage:7,title:'選用功能：Email 通知與網站分析',questions:[
  {key:'mailEnabled',ask:'要寄 Email 通知（報名收件、確認、行前提醒）嗎？需要有自己的網域並在 Resend 驗證。',example:false,default:false,validate:v=>typeof v==='boolean'?'':'請回答要或不要',write:'wrangler'},
  {key:'mailFrom',ask:'寄件人顯示名稱與地址？',example:'幸福社區活動 <notify@mail.example.org>',optional:true,when:a=>a.mailEnabled===true,validate:v=>typeof v==='string'&&(email(v)||/<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(v))?'':'格式應為「名稱 <地址>」或單純地址',write:'wrangler'},
  {key:'mailReplyTo',ask:'住戶回信要寄到哪個信箱？',example:'team@example.org',optional:true,when:a=>a.mailEnabled===true,validate:v=>typeof v==='string'&&email(v)?'':'Email 格式不對',write:'wrangler'},
  {key:'ga4Enabled',ask:'要用 Google Analytics 看網站流量嗎？（訪客同意後才會啟用）',example:false,default:false,validate:v=>typeof v==='boolean'?'':'請回答要或不要',write:'wrangler'},
  {key:'ga4Id',ask:'GA4 衡量 ID？（G- 開頭）',example:'G-ABC123XYZ',optional:true,when:a=>a.ga4Enabled===true,validate:v=>typeof v==='string'&&/^G-[A-Z0-9]{4,20}$/.test(v)?'':'格式應為 G-XXXXXXXXXX',write:'wrangler'}
 ]},
 {id:'launch',stage:8,title:'開站內容（AI 依答案起草，由主辦方貼到後台）',questions:[
  {key:'privacyContact',ask:'住戶想查詢或刪除自己的報名資料時，要聯絡誰？（會寫進個資告知）',example:'幸福社宅管理中心 02-1234-5678',validate:nonEmpty(200,'聯絡方式'),write:'draft'},
  {key:'privacyRetention',ask:'報名資料要保存多久？',example:'活動結束後 1 年',default:'活動結束後 1 年',validate:nonEmpty(100,'保存期限'),write:'draft'},
  {key:'customPage',ask:'要不要多一個自訂分頁（例如社區公約、垃圾清運、交通資訊）？要的話分頁叫什麼、放哪些內容？不需要就回「不需要」',example:'社區公約：公共空間使用規則、垃圾分類時間',optional:true,default:'',validate:optText(500),write:'draft'},
  {key:'firstEvent',ask:'第一個活動是什麼？（名稱、日期時間、地點、名額、收費；還沒決定就回「還沒」）',example:'手機防詐小教室，2027-01-10 14:00–15:30，社區活動中心 1 樓，30 人，免費',optional:true,default:'',validate:optText(500),write:'draft'}
 ]}
];
export const questions=stages.flatMap(s=>s.questions.map(q=>({...q,stageId:s.id})));
export const byKey=Object.fromEntries(questions.map(q=>[q.key,q]));
export const valueOf=(q,a)=>a[q.key]!==undefined&&a[q.key]!==null?a[q.key]:typeof q.default==='function'?q.default(a):q.default;
