// About page: blocks edited in the admin (see blocks.js).
import './site.js';
import {loadBlocks} from './blocks.js';
export {renderBlock} from './blocks.js';
loadBlocks(document.querySelector('#about-blocks'),'/api/about','關於我們');
