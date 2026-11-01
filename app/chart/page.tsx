'use client';
import { Suspense, useEffect, useState } from 'react';
import { AccountGuard, useAccount } from '@/components/AccountProvider';
import BirthForm from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
import RecordHeader from '@/components/RecordHeader';
import PalaceDetails from '@/components/PalaceDetails';
import { useChartHistory } from '@/lib/use-chart-history';
import { generateChart } from '@/lib/ziwei/algorithm';
import { isComparisonRecord, recordHref } from '@/lib/chart-history';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BirthInfo, Palace } from '@/lib/ziwei/types';

/**
 * 命盘页 —— 开源版「排盘引擎 Demo」
 *
 * 这是一个最小可运行示例：用本仓库的排盘引擎 generateChart() 配合基础 UI
 * 组件，渲染一张完整紫微命盘 + 基础解读，并支持本命 / 大限 / 流年切换。
 *
 * 说明：线上商业版的完整交互界面（重设计的新 UI、AI 流式解读、合盘、分享
 * 卡片等）不在开源范围内；但排盘内核——安星算法、四化、格局识别、古籍库——
 * 完全开放（见 lib/ziwei/*），可自由二次开发出你自己的界面。
 */
export default function ChartPage() {
  return <Suspense fallback={<main className="account-shell">正在读取命盘…</main>}><AccountGuard><ChartContent /></AccountGuard></Suspense>;
}
function ChartContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAccount();
  const mobileTab = params.get('view') === 'insight' ? 'insight' : 'chart';
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);
  const [detailPalace, setDetailPalace] = useState<Palace | null>(null);
  const [freshRecordId, setFreshRecordId] = useState<string | null>(null);
  const { history, ready, storageError, syncState, retrySync, create, select, updateInsight } = useChartHistory();
  useEffect(() => {
    if (!ready) return;
    if (params.get('new') === '1') { if (history.activeId) select(null); router.replace('/chart'); return; }
    const id = params.get('record');
    const target = history.records.find(record => record.id === id);
    if (target && isComparisonRecord(target)) { router.replace(recordHref(target)); return; }
    if (target && history.activeId !== target.id) select(target.id);
  }, [ready, history.records, history.activeId, params, select, router]);
  const activeRecord = history.records.find(record => record.id === history.activeId && !isComparisonRecord(record));
  const chart = activeRecord?.chart;
  const fresh = () => { setFreshRecordId(null); setSelectedPalace(null); router.replace('/chart?new=1'); };
  const showView = (view: string) => { router.replace(`/chart?record=${activeRecord!.id}${view === 'insight' ? '&view=insight' : ''}`, { scroll:false }); };

  if (!ready) return <main className="account-shell"><p role="status">正在读取账号记录…</p></main>;

  // ── 未起盘：展示出生信息表单 ──
  if (!activeRecord || !chart) {
    return (
      <main className="chart-shell chart-create" style={{ maxWidth: 640 }}>
        <h1>新建命盘</h1>
        <p className="muted create-intro">
          填写出生资料，校对后生成命盘。未提交的资料会保留在此设备的当前会话。
        </p>
        {storageError && <p role="alert" className="form-error">{storageError}</p>}
        <BirthForm draftKey="single" initialData={{ name: user?.profile.displayName, year: user?.profile.birthday.slice(0, 4), month: user?.profile.birthday ? String(Number(user.profile.birthday.slice(5, 7))) : '', day: user?.profile.birthday ? String(Number(user.profile.birthday.slice(8, 10))) : '', clockHour: user?.profile.birthTime ? String(Number(user.profile.birthTime.slice(0, 2))) : '8', clockMinute: user?.profile.birthTime ? String(Number(user.profile.birthTime.slice(3, 5))) : '0', gender: user?.profile.gender || 'male' }} onSubmit={(info: BirthInfo) => { const id = create(generateChart(info)); setFreshRecordId(id); router.replace(`/chart?record=${id}`); }} />
      </main>
    );
  }

  // ── 已起盘：命盘 + 解读 ──
  return (
    <main className="chart-shell chart-reading" style={{ maxWidth: 1280 }}>
      <RecordHeader title={activeRecord.label} syncState={syncState} error={storageError} onRetry={retrySync} onNew={fresh} />

      <div className="mobile-chart-tabs segmented" role="group" aria-label="命盘与解读视图">
        <button aria-pressed={mobileTab === 'chart'} onClick={() => showView('chart')}>十二宫命盘</button>
        <button aria-pressed={mobileTab === 'insight'} onClick={() => showView('insight')}>AI 解读</button>
      </div>
      <div className="chart-layout">
        <div className="chart-mobile-panel" data-active={mobileTab === 'chart'}><ChartBoard key={`chart-${activeRecord.id}`} chart={chart} onPalaceSelect={setDetailPalace} /></div>
        <div className="chart-mobile-panel" data-active={mobileTab === 'insight'}><InsightPanel key={`insight-${activeRecord.id}`} chart={chart} selectedPalace={selectedPalace}
          readingKey={activeRecord.id}
          initialState={activeRecord.insight}
          autoInterpret={freshRecordId === activeRecord.id}
          onStateChange={(insight, immediate) => updateInsight(activeRecord.id, insight, immediate)} /></div>
      </div>
      {detailPalace && <PalaceDetails palace={detailPalace} onClose={() => setDetailPalace(null)} onInterpret={() => { setSelectedPalace(detailPalace); setDetailPalace(null); showView('insight'); }} />}
    </main>
  );
}
