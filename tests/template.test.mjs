import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {publicSite} from '../src/site.js';

const root=new URL('..',import.meta.url).pathname;
test('Claude 與 Codex 讀到同一份 community-setup skill；Gemini 由 GEMINI.md 匯入',()=>{
 const a=readFileSync(join(root,'.agents/skills/community-setup/SKILL.md'),'utf8'),b=readFileSync(join(root,'.claude/skills/community-setup/SKILL.md'),'utf8');
 assert.equal(a,b,'run: cp .agents/skills/community-setup/SKILL.md .claude/skills/community-setup/SKILL.md');
 assert.match(a,/^---\nname: community-setup\ndescription: /);
 assert.match(readFileSync(join(root,'GEMINI.md'),'utf8'),/@AGENTS\.md[\s\S]*@\.agents\/skills\/community-setup\/SKILL\.md/);
 assert.match(readFileSync(join(root,'CLAUDE.md'),'utf8'),/@AGENTS\.md/);
});
test('site.config.json 合法，公開設定只含白名單欄位與 https 連結',()=>{
 const raw=JSON.parse(readFileSync(join(root,'site.config.json'),'utf8'));assert.ok(raw.brand&&Array.isArray(raw.identities));
 const pub=publicSite();assert.deepEqual(Object.keys(pub).sort(),['about','brand','brandMark','communityName','description','englishBrand','feedbackOrganizer','heroText','heroTitle','identities','links','tagline','themeColor'].sort());
 assert.ok(pub.links.every(l=>/^https?:\/\//.test(l.url)));
});
