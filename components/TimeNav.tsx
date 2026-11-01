'use client';
import { STEMS, SI_HUA_TABLE } from '@/lib/ziwei/constants';
import type { ZiweiChart } from '@/lib/ziwei/types';

export type TimeView = 'mingpan' | 'daxian' | 'liunian';

interface TimeNavProps {
  chart: ZiweiChart;
  view: TimeView;
  liunianYear: number;
  onViewChange: (view: TimeView) => void;
  onYearChange: (year: number) => void;
}

/** 由年份计算天干索引 (0-9) */
export function getYearStemIndex(year: number): number {
  return ((year - 4) % 10 + 10) % 10;
}

/** 根据天干索引返回四化映射：starName → SiHua */
export function buildSiHuaOverlay(stemIndex: number): Record<string, string> {
  const stars = SI_HUA_TABLE[stemIndex];
  if (!stars) return {};
  return {
    [stars[0]]: '禄',
    [stars[1]]: '权',
    [stars[2]]: '科',
    [stars[3]]: '忌',
  };
}

const SIHUA_COLORS: Record<string, string> = {
  '禄': '#4ade80',
  '权': '#60a5fa',
  '科': '#facc15',
  '忌': '#f87171',
};

export default function TimeNav({
  chart,
  view,
  liunianYear,
  onViewChange,
  onYearChange,
}: TimeNavProps) {
  const currentDx = chart.daXians[chart.currentDaXianIndex];

  // 计算当前叠加四化信息
  const getOverlayInfo = (): { stemName: string; overlay: Record<string, string> } | null => {
    if (view === 'mingpan') return null;

    if (view === 'daxian' && currentDx) {
      const dxPalace = chart.palaces.find(p => p.branch === currentDx.palaceBranch);
      if (!dxPalace) return null;
      const stemIndex = dxPalace.stem;
      return {
        stemName: STEMS[stemIndex],
        overlay: buildSiHuaOverlay(stemIndex),
      };
    }

    if (view === 'liunian') {
      const stemIndex = getYearStemIndex(liunianYear);
      return {
        stemName: STEMS[stemIndex],
        overlay: buildSiHuaOverlay(stemIndex),
      };
    }

    return null;
  };

  const overlayInfo = getOverlayInfo();

  return <div className="time-nav">
    <div className="segmented" role="group" aria-label="命盘时间视图">
      <button type="button" aria-pressed={view === 'mingpan'} onClick={() => onViewChange('mingpan')}>本命</button>
      <button type="button" aria-pressed={view === 'daxian'} onClick={() => onViewChange('daxian')}>大限{currentDx ? ' ' + currentDx.startAge + '–' + currentDx.endAge : ''}</button>
      <button type="button" aria-pressed={view === 'liunian'} onClick={() => onViewChange('liunian')}>流年</button>
    </div>
    {view === 'liunian' && <div className="year-picker">
      <button type="button" aria-label="上一年" disabled={liunianYear <= 1900} onClick={() => onYearChange(liunianYear - 1)}>‹</button>
      <select aria-label="流年年份" value={liunianYear} onChange={event => onYearChange(Number(event.target.value))}>{Array.from({ length: 201 }, (_, index) => 1900 + index).map(year => <option key={year} value={year}>{year} 年</option>)}</select>
      <button type="button" aria-label="下一年" disabled={liunianYear >= 2100} onClick={() => onYearChange(liunianYear + 1)}>›</button>
    </div>}
    {overlayInfo && <p className="time-overlay">{view === 'daxian' ? '大限' : liunianYear} · {overlayInfo.stemName}年四化：
      {(['禄', '权', '科', '忌'] as const).map(siHua => { const star = Object.keys(overlayInfo.overlay).find(key => overlayInfo.overlay[key] === siHua); return star ? <span key={siHua} style={{ color: SIHUA_COLORS[siHua], marginRight: 8 }}>{star}化{siHua}</span> : null; })}
    </p>}
  </div>;
}
