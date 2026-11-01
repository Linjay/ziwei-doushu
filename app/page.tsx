import type { Metadata } from 'next';
import HomePage from '@/components/home/HomePage';
import './home.css';

export const metadata: Metadata = {
  title: '紫微命盘 · 观星见自己',
  description: '公农历排盘、完整真太阳时校正，结合公开样本与古籍节选的 Codex 流式解读。六主题、双人合盘、个人历史与跨设备备份，一键开始体验。',
  openGraph: { title: '紫微命盘 · 观星见自己', description: '星辰为引，资料为据。让一张命盘，成为认识自己的新视角。', type: 'website' },
};
export default function Page() { return <HomePage />; }
