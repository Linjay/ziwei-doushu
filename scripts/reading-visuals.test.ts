import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readingFocus, READING_FOCUS, displayPalaceName } from '../lib/reading-focus';
import { INSIGHT_TOPICS } from '../lib/insight-topics';
import { generateChart } from '../lib/ziwei/algorithm';

const chart=generateChart({year:1990,month:6,day:15,hour:6,gender:'male'});
test('each topic highlights its actual saved palace and the engine branch relationships',()=>{
  const before=JSON.stringify(chart);
  for(const topic of INSIGHT_TOPICS){
    const focus=readingFocus(chart,topic);assert.equal(focus.length,4,topic);assert.equal(focus[0].palaceName,READING_FOCUS[topic].palace);
    assert.deepEqual(focus.map(item=>item.palace.branch),[0,4,8,6].map(offset=>(focus[0].palace.branch+offset)%12));
    assert.equal(new Set(focus.map(item=>item.palace.branch)).size,4);
    assert.ok(focus.every(item=>chart.palaces.includes(item.palace)));
  }
  assert.equal(JSON.stringify(chart),before);
});
test('diagram lookup uses branches rather than array order and preserves historical stars and empty palaces',()=>{
  const saved=structuredClone(chart);saved.palaces.reverse();
  const target=saved.palaces.find(p=>p.name==='命宫')!;target.stars=[{name:'历史记录中的星',type:'major',brightnessRaw:'利',siHua:'科'}];
  assert.equal(readingFocus(saved,'overview')[0].palace,target);assert.equal(readingFocus(saved,'overview')[0].palace.stars[0].name,'历史记录中的星');
  target.stars=[];target.borrowedStars=['旧记录借星'];assert.equal(readingFocus(saved,'personality')[0].palace.borrowedStars?.[0],'旧记录借星');
  assert.deepEqual(readingFocus(saved,'overview').map(p=>p.palace.branch),readingFocus(chart,'overview').map(p=>p.palace.branch));
  const fullNames={...chart,palaces:chart.palaces.map(p=>({...p,name:displayPalaceName(p.name)}))};
  for(const topic of INSIGHT_TOPICS)assert.equal(readingFocus(fullNames,topic).length,4);
});
test('a missing primary palace does not fabricate a replacement or stars',()=>{
  assert.deepEqual(readingFocus({...chart,palaces:chart.palaces.filter(p=>displayPalaceName(p.name)!=='夫妻宫')},'love'),[]);
});
