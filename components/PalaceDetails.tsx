'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Palace } from '@/lib/ziwei/types';
export default function PalaceDetails({ palace, onClose, onInterpret }: { palace: Palace; onClose: () => void; onInterpret: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="palace-sheet" aria-labelledby="palace-detail-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="palace-sheet-heading"><h2 id="palace-detail-title">{palace.name}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭宫位详情" autoFocus><X aria-hidden="true" /></button></div>
    <p className="muted">{palace.isMingGong ? '命宫 · ' : ''}{palace.isShenGong ? '身宫 · ' : ''}{palace.daXianAge ? `大限 ${palace.daXianAge[0]}–${palace.daXianAge[1]} 岁` : '宫位星曜'}</p>
    {palace.stars.length ? <ul className="palace-star-list">{palace.stars.map((star, index) => <li key={index}><strong>{star.name}</strong><span>{star.brightnessRaw || ''}{star.siHua ? ` · 化${star.siHua}` : ''}</span></li>)}</ul> : <p>本宫无星曜。</p>}
    {palace.isEmpty && <p className="muted">空宫{palace.borrowedFromName ? `，借对宫${palace.borrowedFromName}` : ''}；仍需结合三方四正。</p>}
    <button type="button" className="btn-primary" onClick={onInterpret}>让 AI 分析这个宫位</button>
  </dialog>;
}
