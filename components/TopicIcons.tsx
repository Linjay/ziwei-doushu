import { Orbit, Heart, BriefcaseBusiness, WalletCards, HeartPulse, Fingerprint, type LucideIcon } from 'lucide-react';
import type { InsightTopic } from '@/lib/insight-topics';
export const TOPIC_ICONS:Record<InsightTopic,LucideIcon> = {
  overview:Orbit,love:Heart,career:BriefcaseBusiness,wealth:WalletCards,health:HeartPulse,personality:Fingerprint,
};
