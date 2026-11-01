import { birthFormFromOriginal, dateStamp, resolveBirthInput } from '@/lib/birth-input';
import { formatTrueSolarClock, shiftGregorianDate } from '@/lib/ziwei/true-solar-time';
import { BRANCHES } from '@/lib/ziwei/constants';
import type { BirthInfo } from '@/lib/ziwei/types';

export default function BirthCalculationSummary({ birth }: { birth: BirthInfo }) {
  try {
    const form = birthFormFromOriginal(birth);
    if (!form) return <p className="birth-calculation-summary">这是一份旧版排盘结果，保留原命盘与解读。旧版未完整记录出生时分，无法自动校正；如需按完整真太阳时重新计算，请新建命盘。</p>;
    const { solarDate, solar } = resolveBirthInput(form);
    return <details className="birth-calculation-summary"><summary>排盘依据 · {dateStamp(birth)} · {BRANCHES[birth.hour]}时</summary>
      {form.calendar === 'lunar' && <p>原始农历：{form.year} 年{form.isLeapMonth ? '闰' : ''}{form.month} 月 {form.day} 日</p>}
      <p>原始公历：{dateStamp(solarDate)}{solar ? ` · 北京时间 ${String(Number(form.clockHour)).padStart(2, '0')}:${String(Number(form.clockMinute)).padStart(2, '0')}` : ' · 出生时间不详，暂按子时'}</p>
      {solar && <><p>真太阳时：{dateStamp(shiftGregorianDate(solarDate, solar.dayOffset))} {formatTrueSolarClock(solar, true)}</p><p>经度修正 {solar.longitudeCorrectionMinutes.toFixed(2)} 分钟，均时差 {solar.equationOfTimeMinutes.toFixed(2)} 分钟。按校正后的时间，晚子时归次日。</p></>}
    </details>;
  } catch { return <p className="birth-calculation-summary">原始出生资料无法核对，当前展示已保存的命盘。</p>; }
}
