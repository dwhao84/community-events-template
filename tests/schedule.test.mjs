import test from 'node:test';
import assert from 'node:assert/strict';
import {eventNotesMarkup,sessionScheduleLabel} from '../public/schedule.js';

const session={id:'s1',status:'published',starts_at:'2026-11-21T05:30:00.000Z',ends_at:'2026-11-21T06:30:00.000Z'};

test('notes render API session times in Taiwan and reflect rescheduling',()=>{
 const event={notes:'建議自備筆電',sessions:[session]};
 let html=eventNotesMarkup(event);assert.match(html,/2026\/11\/21/);assert.match(html,/13:30–14:30/);assert.match(html,/建議自備筆電/);
 html=eventNotesMarkup({...event,sessions:[{...session,starts_at:'2026-12-05T01:00:00Z',ends_at:'2026-12-05T02:30:00Z'}]});
 assert.match(html,/2026\/12\/05/);assert.match(html,/09:00–10:30/);assert.doesNotMatch(html,/11\/21|13:30/);
});
test('multiple sessions are sorted, cancellation is explicit and drafts excluded',()=>{
 const later={...session,status:'cancelled',starts_at:'2026-11-22T05:30:00Z',ends_at:'2026-11-22T06:30:00Z'};
 const html=eventNotesMarkup({sessions:[later,{...session,status:'draft',starts_at:'2026-11-20T05:30:00Z'},session]});
 assert.ok(html.indexOf('11/21')<html.indexOf('11/22'));assert.match(html,/已取消/);assert.doesNotMatch(html,/11\/20/);
});
test('overnight sessions include the end date in Taiwan',()=>{
 const label=sessionScheduleLabel({...session,starts_at:'2026-11-21T15:30:00Z',ends_at:'2026-11-21T17:00:00Z'});
 assert.match(label,/2026\/11\/21.*23:30–2026\/11\/22.*01:00/);
});
test('missing or malformed schedules do not invent times and notes are escaped',()=>{
 assert.equal(eventNotesMarkup({}), '');
 const html=eventNotesMarkup({notes:'<script>alert(1)</script>',sessions:[{...session,starts_at:'bad'}, {...session,ends_at:session.starts_at}]});
 assert.doesNotMatch(html,/<script>|活動時間|Invalid Date/);assert.match(html,/&lt;script&gt;/);
 assert.match(eventNotesMarkup({sessions:[session]}),/活動注意事項/);
});
