'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import type { BirthInfo } from '@/lib/ziwei/types';
import { SHICHEN } from '@/lib/ziwei/constants';
import { PROVINCES } from '@/lib/ziwei/cities';
import { birthSolarDate, dateStamp, formToBirthInfo, resolveBirthInput, switchBirthCalendar, type BirthFormState } from '@/lib/birth-input';
import { lunarMonthDayCount, LUNAR_YEAR_MIN } from '@/lib/ziwei/lunar-solar';
import { formatTrueSolarClock, shiftGregorianDate as shiftSolarDate } from '@/lib/ziwei/true-solar-time';
import { beijingDate } from '@/lib/account';
import { useAccount } from './AccountProvider';
import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react';

export type { BirthFormState } from '@/lib/birth-input';
export { validBirthDate } from '@/lib/birth-input';
const MONTHS = ['正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','冬月','腊月'];
const DAYS = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
interface BirthFormProps {
  onSubmit: (info: BirthInfo) => void; loading?: boolean;
  initialData?: Partial<BirthFormState>; onFormSave?: (data: BirthFormState) => void;
  hideSubmit?: boolean; draftKey?: string;
}
export default function BirthForm({ onSubmit, loading, initialData, onFormSave, hideSubmit, draftKey }: BirthFormProps) {
  const { user } = useAccount(); const id = useId();
  const storageKey = draftKey && user ? `mingli_draft_${user.id}_${draftKey}` : '';
  const [form, setForm] = useState<BirthFormState>({ name: '', year: '', month: '', day: '', calendar: 'solar', isLeapMonth: false, clockHour: '8', clockMinute: '0', unknownTime: false, province: '', city: '', longitude: 120, gender: 'male', ...initialData });
  const [draftReady, setDraftReady] = useState(false);
  const [step, setStep] = useState(1); const [error, setError] = useState('');
  useEffect(() => {
    if (storageKey) try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (saved && ['name', 'year', 'month', 'day', 'clockHour', 'clockMinute', 'province', 'city'].every(key => typeof saved[key] === 'string') && typeof saved.unknownTime === 'boolean' && ['male', 'female'].includes(saved.gender) && Number.isFinite(saved.longitude) && Math.abs(saved.longitude) <= 180 && (saved.calendar === undefined || ['solar', 'lunar'].includes(saved.calendar)) && (saved.isLeapMonth === undefined || typeof saved.isLeapMonth === 'boolean')) setForm({ calendar: 'solar', isLeapMonth: false, ...saved });
    } catch {}
    setDraftReady(true);
  }, [storageKey]);
  useEffect(() => {
    onFormSave?.({ ...form });
    if (storageKey && draftReady) try { sessionStorage.setItem(storageKey, JSON.stringify(form)); } catch {}
  }, [form, onFormSave, storageKey, draftReady]);
  const cities = useMemo(() => PROVINCES.find(p => p.name === form.province)?.cities || [], [form.province]);
  const field = <K extends keyof BirthFormState>(key: K, value: BirthFormState[K]) => { setError(''); setForm(previous => ({ ...previous, [key]: value })); };
  const preview = useMemo(() => { try { return resolveBirthInput(form); } catch { return null; } }, [form]);
  const solarDate = birthSolarDate(form);
  const lunar = form.calendar === 'lunar';
  const lunarMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1).flatMap(month => [false, true].flatMap(leap => lunarMonthDayCount(Number(form.year), month, leap) ? [{ month, leap, value: String(leap ? -month : month), label: `${leap ? '闰' : ''}${MONTHS[month - 1]}` }] : [])), [form.year]);
  const lunarDays = lunarMonthDayCount(Number(form.year), Number(form.month), form.isLeapMonth);
  const changeCalendar = (calendar: 'solar' | 'lunar') => { try { setForm(switchBirthCalendar(form, calendar)); setError(''); } catch (error) { setError((error as Error).message); } };
  const changeLunarMonth = (year: string, month: string, isLeapMonth: boolean) => {
    const count = lunarMonthDayCount(Number(year), Number(month), isLeapMonth);
    setForm(previous => ({ ...previous, year, month: count ? month : '', isLeapMonth: count ? isLeapMonth : false, day: count && Number(previous.day) <= count ? previous.day : '' })); setError('');
  };
  const birthday = form.year && form.month && form.day ? `${form.year}-${form.month.padStart(2, '0')}-${form.day.padStart(2, '0')}` : '';
  const time = `${form.clockHour.padStart(2, '0')}:${form.clockMinute.padStart(2, '0')}`;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    let info: BirthInfo;
    try { info = formToBirthInfo(form); } catch (error) { setError((error as Error).message); setStep(1); return; }
    if (!hideSubmit && step === 1) { setStep(2); return; }
    onSubmit(info);
    if (storageKey) try { sessionStorage.removeItem(storageKey); } catch {}
  };
  return <form className={`birth-form ${hideSubmit ? 'birth-form-compact' : ''}`} onSubmit={submit} aria-label="出生资料">
    {!hideSubmit && <div className="birth-progress" aria-label={`第 ${step} 步，共两步`}><span className={step === 1 ? 'active' : ''}>1 出生资料</span><span className={step === 2 ? 'active' : ''}>2 地点与确认</span></div>}
    {(step === 1 || hideSubmit) && <div className="birth-fields">
      <label>姓名 <span className="optional">选填</span><input name="birthName" value={form.name} onChange={event => field('name', event.target.value)} maxLength={40} autoComplete="off" placeholder="如何称呼这份命盘" /></label>
      <fieldset className="birth-calendar"><legend>出生日期</legend><div className="segmented" role="group" aria-label="日期历法">{(['solar', 'lunar'] as const).map(value => <button key={value} type="button" aria-pressed={(form.calendar || 'solar') === value} onClick={() => changeCalendar(value)}>{value === 'solar' ? '公历' : '农历'}</button>)}</div>
        {lunar ? <div className="lunar-date-fields">
          <label>农历年<select name="lunarYear" value={form.year} required onChange={event => changeLunarMonth(event.target.value, form.month, form.isLeapMonth === true)}><option value="">选择年</option>{Array.from({ length: Number(beijingDate().slice(0, 4)) - LUNAR_YEAR_MIN + 1 }, (_, index) => Number(beijingDate().slice(0, 4)) - index).map(year => <option key={year} value={year}>{year} 年</option>)}</select></label>
          <label>农历月<select name="lunarMonth" value={form.month ? String(form.isLeapMonth ? -Number(form.month) : Number(form.month)) : ''} required disabled={!form.year} onChange={event => changeLunarMonth(form.year, event.target.value ? String(Math.abs(Number(event.target.value))) : '', Number(event.target.value) < 0)}><option value="">选择月</option>{lunarMonths.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}</select></label>
          <label>农历日<select name="lunarDay" value={form.day} required disabled={!lunarDays} onChange={event => field('day', event.target.value)}><option value="">选择日</option>{DAYS.slice(0, lunarDays).map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
        </div> : <label className="solar-date-label"><span className="sr-only">公历出生日期</span><input name="birthday" type="date" aria-label="公历出生日期" value={birthday} min="1900-01-01" max={beijingDate()} required onChange={event => { const [year = '', month = '', day = ''] = event.target.value.split('-'); setForm(previous => ({ ...previous, year, month, day })); setError(''); }} /></label>}
        <p className="calendar-hint" role="status">{lunar ? (solarDate ? `对应公历：${dateStamp(solarDate)}。请确认是否为闰月。` : '按出生当年的农历年、月、日选择；有闰月的年份会单独列出。') : '公历、农历切换会保留同一天。'}</p>
      </fieldset>
      <label>出生时间 <span className="optional">北京时间，默认 08:00，请确认</span><input name="birthTime" type="time" value={time} required={!form.unknownTime} disabled={form.unknownTime} onChange={event => { const [clockHour = '', clockMinute = ''] = event.target.value.split(':'); setForm(previous => ({ ...previous, clockHour, clockMinute })); }} /></label>
      <label className="check-row"><input type="checkbox" checked={form.unknownTime} onChange={event => field('unknownTime', event.target.checked)} /><span>不知道具体出生时间<small>暂按子时起盘，解读存在不确定性。</small></span></label>
      <fieldset className="birth-gender"><legend>性别</legend><div className="segmented">{(['male', 'female'] as const).map(value => <button key={value} type="button" aria-pressed={form.gender === value} onClick={() => field('gender', value)}>{value === 'male' ? '男' : '女'}</button>)}</div></fieldset>
    </div>}
    {(step === 2 || hideSubmit) && <div className="birth-fields">
      {!hideSubmit && <div className="birth-section-heading"><MapPin size={20} aria-hidden="true" /><h2>出生地点</h2><span className="optional">选填，用于时间校正</span></div>}
      <div className="form-columns">
        <label>省份 / 直辖市<select name="birthProvince" value={form.province} onChange={event => { const province = event.target.value, first = PROVINCES.find(p => p.name === province)?.cities[0]; setForm(previous => ({ ...previous, province, city: first?.name || '', longitude: first?.longitude ?? 120 })); }}><option value="">暂不填写</option>{PROVINCES.map(p => <option key={p.name}>{p.name}</option>)}</select></label>
        <label>出生城市<select name="birthCity" value={form.city} disabled={!form.province} onChange={event => { const city = event.target.value; setForm(previous => ({ ...previous, city, longitude: cities.find(c => c.name === city)?.longitude ?? 120 })); }}><option value="">{form.province ? '选择城市' : '先选省份'}</option>{cities.map(city => <option key={city.name}>{city.name}</option>)}</select></label>
      </div>
      <details className="birth-explanation"><summary>时间校正与未知时间规则</summary><p>北京时间先按出生地经度差与当日均时差校正为真太阳时；不填地点按东经 120°。以真太阳日为基础，23:00–23:59 的晚子时按次日排盘，00:00–00:59 按当日。未知时间不做时间校正，按输入日期、子时暂排。</p><p>时间请填北京时间的标准时；当年使用夏令时的钟表读数需先减去夏令时偏移。</p></details>
      {preview && <section className="birth-confirm" aria-labelledby={id}><h2 id={id}>{hideSubmit ? '排盘口径' : '确认出生资料'}</h2><p>{form.name || '未命名'} · {lunar ? `农历 ${form.year} 年${form.isLeapMonth ? '闰' : ''}${MONTHS[Number(form.month) - 1]}${DAYS[Number(form.day) - 1]} · ` : ''}公历 {dateStamp(preview.solarDate)} · {form.gender === 'male' ? '男' : '女'}</p><p>{form.unknownTime ? '时间不详，暂按子时' : `北京时间 ${time}`} · {form.city || '东经 120°（默认）'}</p><p className="birth-conversion" role="status">{preview.solar ? `真太阳时 ${dateStamp(shiftSolarDate(preview.solarDate, preview.solar.dayOffset))} ${formatTrueSolarClock(preview.solar, true)} · ${SHICHEN[preview.birthInfo.hour]?.name}；排盘日 ${dateStamp(preview.birthInfo)}${preview.dayOffset ? '（已换日）' : ''}` : `排盘日 ${dateStamp(preview.birthInfo)} · 未知时间暂排`}</p>{!hideSubmit && <p className="muted">生成后保存到你的账号，并开始总览解读。</p>}</section>}
    </div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {!hideSubmit && <div className="birth-actions">{step === 2 && <button type="button" className="small-button" onClick={() => setStep(1)}><ArrowLeft size={18} aria-hidden="true" />上一步</button>}<button type="submit" className="btn-primary" disabled={loading}>{loading ? '正在生成…' : step === 1 ? '下一步' : '生成命盘'}<ArrowRight size={18} aria-hidden="true" /></button></div>}
  </form>;
}
