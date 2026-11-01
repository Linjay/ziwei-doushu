import assert from 'node:assert/strict';
import { test } from 'node:test';
import { birthSolarDate, formToBirthInfo, resolveBirthInput, switchBirthCalendar, validBirthDate, validateBirthProvenance, type BirthFormState } from '../lib/birth-input';
import { formToSearchParams, searchParamsToForm } from '../lib/ziwei/share';
import { generateChart } from '../lib/ziwei/algorithm';
import { lunarMonthDayCount } from '../lib/ziwei/lunar-solar';
import { addChartRecord, addComparisonRecord, decodeHistory, emptyHistory } from '../lib/chart-history';
import { parseHistoryBackup, serializeHistoryBackup } from '../lib/history-backup';

const form = (patch: Partial<BirthFormState> = {}): BirthFormState => ({ name:'时间验收', year:'1990', month:'6', day:'15', clockHour:'23', clockMinute:'30', unknownTime:false, province:'', city:'', longitude:120, gender:'male', ...patch });
const key = (value: ReturnType<typeof formToBirthInfo>) => [value.year,value.month,value.day,value.hour];

test('late Zi uses the next day in the shared single/comparison conversion', () => {
  assert.deepEqual(key(formToBirthInfo(form())), [1990,6,16,0]);
  assert.deepEqual(key(formToBirthInfo(form({clockHour:'0'}))), [1990,6,15,0]);
});
test('equation of time crosses the Zi/Chou boundary at 00:50', () => {
  const result = resolveBirthInput(form({month:'11',day:'3',clockHour:'0',clockMinute:'50'}));
  assert.deepEqual(key(result.birthInfo), [1990,11,3,1]);
  assert.equal(result.solar?.hour,1); assert.equal(result.solar?.minute,6);
  assert.ok(Math.abs(result.solar!.equationOfTimeMinutes - 16.37)<0.01);
});
test('late Zi is decided by the corrected clock, including raw 22:50 and raw 23:30 in the west', () => {
  assert.deepEqual(key(formToBirthInfo(form({month:'11',day:'3',clockHour:'22',clockMinute:'50'}))),[1990,11,4,0]);
  assert.deepEqual(key(formToBirthInfo(form({longitude:75}))),[1990,6,15,10]);
});
test('solar correction can move to the previous day, including a month boundary', () => {
  assert.deepEqual(key(formToBirthInfo(form({month:'7',day:'1',clockHour:'0',longitude:75}))),[1990,6,30,11]);
  assert.deepEqual(key(formToBirthInfo(form({clockHour:'0',longitude:105}))),[1990,6,15,0]);
});
test('forward midnight, leap-day and year-end carry happen exactly once', () => {
  assert.deepEqual(key(formToBirthInfo(form({month:'11',day:'3',clockMinute:'55',longitude:121}))),[1990,11,4,0]);
  assert.deepEqual(key(formToBirthInfo(form({year:'2000',month:'2',day:'29'}))),[2000,3,1,0]);
  assert.deepEqual(key(formToBirthInfo(form({month:'12',day:'31'}))),[1991,1,1,0]);
});
test('unknown time keeps the actual input date and records uncertainty', () => {
  const result=resolveBirthInput(form({unknownTime:true,clockHour:'',clockMinute:'',longitude:75}));
  assert.deepEqual(key(result.birthInfo),[1990,6,15,0]);assert.equal(result.solar,null);assert.equal(result.birthInfo.origInput?.unknownTime,true);
});
test('lunar New Year and leap second month map to known Gregorian dates', () => {
  assert.deepEqual(birthSolarDate(form({calendar:'lunar',year:'2024',month:'1',day:'1'})),{year:2024,month:2,day:10});
  assert.deepEqual(birthSolarDate(form({calendar:'lunar',year:'2023',month:'2',day:'1',isLeapMonth:true})),{year:2023,month:3,day:22});
  assert.deepEqual(birthSolarDate(form({calendar:'lunar',year:'2023',month:'2',day:'1'})),{year:2023,month:2,day:20});
});
test('nonexistent leap months and small-month day 30 are rejected, not normalized', () => {
  assert.equal(validBirthDate(form({calendar:'lunar',year:'2024',isLeapMonth:true})),false);
  assert.equal(lunarMonthDayCount(2023,2,true),29);
  assert.throws(()=>formToBirthInfo(form({calendar:'lunar',year:'2023',month:'2',day:'30',isLeapMonth:true})),/真实/);
  assert.throws(()=>formToBirthInfo(form({year:'2023',month:'2',day:'29'})),/真实/);
});
test('calendar toggles preserve the actual date and leap-month identity', () => {
  const original=form({year:'2023',month:'3',day:'22'}), lunar=switchBirthCalendar(original,'lunar');
  assert.equal(lunar.isLeapMonth,true);assert.equal(lunar.month,'2');assert.equal(lunar.day,'1');
  assert.deepEqual(switchBirthCalendar(lunar,'solar'),{...original,calendar:'solar',isLeapMonth:false});
  assert.throws(()=>switchBirthCalendar(form({year:'1900',month:'1',day:'1'}),'lunar'),/范围/);
});
test('Gregorian/lunar inputs for the same instant produce identical chart facts', () => {
  const original=form({year:'2023',month:'3',day:'22',clockHour:'22',clockMinute:'58'});
  const solar=generateChart(formToBirthInfo(original)), lunar=generateChart(formToBirthInfo(switchBirthCalendar(original,'lunar')));
  assert.deepEqual(solar.palaces,lunar.palaces);assert.deepEqual(solar.lunarInfo,lunar.lunarInfo);assert.deepEqual(key(solar.birthInfo),key(lunar.birthInfo));
});
test('future dates and malformed times/longitude cannot reach generation', () => {
  assert.equal(validBirthDate(form({year:'2024',month:'2',day:'11'}),'2024-02-10'),false);
  for(const patch of [{clockHour:'24'},{clockMinute:'60'},{longitude:NaN},{longitude:181}])assert.throws(()=>formToBirthInfo(form(patch)));
  assert.throws(()=>formToBirthInfo(form({year:'1900',month:'1',day:'1',clockHour:'0',longitude:75})),/排盘日超出支持范围/);
});
test('original Gregorian clock and lunar input survive URL round trips', () => {
  const lunar=form({calendar:'lunar',year:'2023',month:'2',day:'1',isLeapMonth:true});
  assert.deepEqual(formToBirthInfo({...lunar,...searchParamsToForm(formToSearchParams(lunar))}),formToBirthInfo(lunar));
  assert.equal(searchParamsToForm(new URLSearchParams('y=1990&m=6&d=15'))?.calendar,'solar');
});
test('validated provenance keeps the adjusted day once; tampering is rejected', () => {
  const birth=formToBirthInfo(form());assert.deepEqual(validateBirthProvenance(birth),birth);
  assert.throws(()=>validateBirthProvenance({...birth,day:15}),/不一致/);
  assert.throws(()=>validateBirthProvenance({...birth,origInput:{...birth.origInput!,day:14}}),/不一致/);
  const legacy={year:1990,month:6,day:15,hour:0,gender:'male' as const};assert.deepEqual(validateBirthProvenance(legacy),legacy);
});

test('single/comparison storage and JSON backups retain lunar provenance without converting again', () => {
  const chart=generateChart(formToBirthInfo(form({calendar:'lunar',year:'2023',month:'2',day:'1',isLeapMonth:true})));
  const history=addComparisonRecord(addChartRecord(emptyHistory(),chart,'single'),chart,chart,'pair');
  for (const restored of [decodeHistory(JSON.stringify(history)),parseHistoryBackup(serializeHistoryBackup(history))]) {
    assert.equal(restored.records.length,2);
    for(const record of restored.records)assert.deepEqual(record.chart.birthInfo,JSON.parse(JSON.stringify(chart.birthInfo)));
    const pair=restored.records.find(record=>record.kind==='comparison')!;
    assert.deepEqual(pair.chartB!.birthInfo.origInput?.lunarDate,{year:2023,month:2,day:1,isLeapMonth:true});
  }
});
