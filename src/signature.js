import {fail} from './lib.js';
export function signatureJSON(value){
 if(value===undefined||value===null)return null;
 if(!Array.isArray(value)||!value.length||value.length>100||JSON.stringify(value).length>20000||value.some(line=>!Array.isArray(line)||!line.length||line.length>1000||line.some(pt=>!Array.isArray(pt)||pt.length!==2||pt.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))))fail(400,'手寫姓名格式錯誤或筆畫過多');
 return JSON.stringify(value);
}
