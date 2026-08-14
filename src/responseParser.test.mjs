import assert from 'node:assert/strict';
import { toInternalMission } from './responseParser.js';
const ctx={form:{committee:'',agenda:'A',portfolio:'P'},sliders:{aggression:0,controversy:0,diplomacy:0,length:0},includeFollowUp:false,poiCount:1,targetingMode:'selected_global'};
const cases=[
 {pois:[{target:'USA',question:'How does the delegation reconcile this?'}]},
 {targets:[{country:'USA',pois:[{question:'How does the delegation reconcile this?'}]}]},
 [{target:'USA',poi:'How does the delegation reconcile this?'}],
 {chits:[{country:'USA',text:'How does the delegation reconcile this?'}]},
 '```json\n{"pois":[{"target":"USA","question":"How does the delegation reconcile this?"}]}\n```',
 'Here are the requested POIs:\n\n{"pois":[{"target":"USA","question":"How does the delegation reconcile this?"}]}',
 'USA — How does the delegation reconcile this?\nChina — Why does the delegation accept this?'
];
cases.forEach((input,i)=>{const m=toInternalMission(input,ctx); assert.ok(m.chits.length>=1,`case ${i+1}`); assert.ok(m.chits[0].poi.includes('?'));});
console.log('responseParser tests passed');
