// Organizer-defined page (後台「自訂頁面」): name and blocks come from /api/page; the static HTML stays when nothing loads.
import './site.js';
import {loadBlocks} from './blocks.js';
const data=await loadBlocks(document.querySelector('#page-blocks'),'/api/page','社區資訊');
if(data?.title)document.title=data.title;
