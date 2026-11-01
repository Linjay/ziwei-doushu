import { Solar } from 'lunar-javascript';
import { beijingDate } from './account';
import { lunarMonthDayCount, lunarToSolar } from './ziwei/lunar-solar';
import { calculateTrueSolarTime, isValidGregorianDate, resolveZiweiDayOffset, shiftGregorianDate, type GregorianDate } from './ziwei/true-solar-time';
import type { BirthInfo } from './ziwei/types';

export interface BirthFormState {
  name: string; year: string; month: string; day: string;
  clockHour: string; clockMinute: string; unknownTime: boolean;
  province: string; city: string; longitude: number; gender: 'male' | 'female';
  /** Missing on older drafts and URLs means Gregorian. */
  calendar?: 'solar' | 'lunar'; isLeapMonth?: boolean;
}

export const dateStamp = (date: GregorianDate) => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

export function birthSolarDate(form: BirthFormState): GregorianDate | null {
  if (![form.year, form.month, form.day].every(value => /^\d+$/.test(value))) return null;
  const year = Number(form.year), month = Number(form.month), day = Number(form.day);
  if (form.calendar === 'lunar') return lunarToSolar(year, month, day, form.isLeapMonth === true);
  return isValidGregorianDate(year, month, day) ? { year, month, day } : null;
}

export function validBirthDate(form: BirthFormState, today = beijingDate()): boolean {
  const date = birthSolarDate(form);
  return !!date && dateStamp(date) >= '1900-01-01' && dateStamp(date) <= today;
}

/** Preserve the same real date when switching calendars; reject unsupported years. */
export function switchBirthCalendar(form: BirthFormState, calendar: 'solar' | 'lunar'): BirthFormState {
  if ((form.calendar || 'solar') === calendar) return form;
  const solar = birthSolarDate(form);
  if (!solar) return { ...form, calendar, year: '', month: '', day: '', isLeapMonth: false };
  if (calendar === 'solar') return { ...form, calendar, year: String(solar.year), month: String(solar.month), day: String(solar.day), isLeapMonth: false };
  const lunar = Solar.fromYmd(solar.year, solar.month, solar.day).getLunar();
  const year = lunar.getYear(), month = Math.abs(lunar.getMonth());
  if (!lunarMonthDayCount(year, month, lunar.getMonth() < 0)) throw new Error('此日期超出农历输入范围，请使用公历。');
  return { ...form, calendar, year: String(year), month: String(month), day: String(lunar.getDay()), isLeapMonth: lunar.getMonth() < 0 };
}

/** One conversion for single charts, comparisons and previews. Input clocks are Beijing standard time. */
export function resolveBirthInput(form: BirthFormState, today = beijingDate()) {
  if (form.calendar !== undefined && !['solar', 'lunar'].includes(form.calendar)) throw new Error('请选择公历或农历。');
  const solarDate = birthSolarDate(form);
  if (!solarDate || !validBirthDate(form, today)) throw new Error('请选择真实的出生日期，换算后的公历需在 1900 年至今天之间。');
  if (!['male', 'female'].includes(form.gender)) throw new Error('请选择性别。');
  if (!form.unknownTime && (!/^([01]?\d|2[0-3])$/.test(form.clockHour) || !/^[0-5]?\d$/.test(form.clockMinute))) throw new Error('请确认出生时间，或选择不知道具体时间。');
  if (!Number.isFinite(form.longitude) || Math.abs(form.longitude) > 180) throw new Error('出生地经度无效，请重新选择地点。');
  const clockHour = form.unknownTime ? 0 : Number(form.clockHour), clockMinute = form.unknownTime ? 0 : Number(form.clockMinute);
  const solar = form.unknownTime ? null : calculateTrueSolarTime({ ...solarDate, clockHour, clockMinute, longitude: form.longitude, utcOffsetMinutes: 480 });
  const dayOffset = solar ? resolveZiweiDayOffset(solar, 'next-day') : 0;
  const chartDate = shiftGregorianDate(solarDate, dayOffset);
  if (chartDate.year < 1900 || chartDate.year > 2100) throw new Error('时间校正后的排盘日超出支持范围（1900–2100），请核对日期与出生地点。');
  const birthInfo: BirthInfo = {
    ...chartDate, hour: solar?.branch ?? 0, gender: form.gender,
    name: form.name || undefined, province: form.province || undefined, city: form.city || undefined,
    longitude: form.longitude,
    origInput: {
      ...solarDate, clockHour, clockMinute, conversionVersion: 1, unknownTime: form.unknownTime,
      calendar: form.calendar || 'solar',
      ...(form.calendar === 'lunar' ? { lunarDate: { year: Number(form.year), month: Number(form.month), day: Number(form.day), isLeapMonth: form.isLeapMonth === true } } : {}),
    },
  };
  return { birthInfo, solarDate, solar, dayOffset };
}

export function formToBirthInfo(form: BirthFormState): BirthInfo { return resolveBirthInput(form).birthInfo; }

/** Used to validate optional provenance from backups and AI requests; never converts an adjusted chart twice. */
export function birthFormFromOriginal(birth: BirthInfo): BirthFormState | null {
  const input = birth.origInput;
  if (!input || input.conversionVersion === undefined) return null;
  if (input.conversionVersion !== 1) throw new Error('出生时间转换版本不支持，请重新起盘。');
  const date = input.calendar === 'lunar' ? input.lunarDate : input;
  if (!date || ![date.year, date.month, date.day, input.clockHour, input.clockMinute].every(Number.isInteger)
    || !['solar', 'lunar'].includes(input.calendar || '') || typeof input.unknownTime !== 'boolean'
    || (input.calendar === 'lunar' && typeof input.lunarDate?.isLeapMonth !== 'boolean')) throw new Error('原始出生资料不完整，请重新起盘。');
  return {
    name: birth.name || '', year: String(date.year), month: String(date.month), day: String(date.day),
    calendar: input.calendar, isLeapMonth: input.lunarDate?.isLeapMonth,
    clockHour: String(input.clockHour), clockMinute: String(input.clockMinute), unknownTime: input.unknownTime,
    province: birth.province || '', city: birth.city || '', longitude: birth.longitude as number, gender: birth.gender,
  };
}

export function validateBirthProvenance(birth: BirthInfo): BirthInfo {
  const form = birthFormFromOriginal(birth);
  if (!form) return birth;
  const expected = formToBirthInfo(form);
  if ((['year', 'month', 'day', 'hour'] as const).some(key => expected[key] !== birth[key])
    || (['year', 'month', 'day', 'clockHour', 'clockMinute'] as const).some(key => expected.origInput![key] !== birth.origInput![key])) {
    throw new Error('原始出生资料与排盘口径不一致，请重新起盘。');
  }
  return expected;
}
