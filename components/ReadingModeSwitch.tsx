import type { ReadingMode } from '@/lib/reading-modes';
import { BookOpenText, MessageCircle } from 'lucide-react';
export default function ReadingModeSwitch({ value,onChange,compact=false }: { value: ReadingMode; onChange:(mode:ReadingMode)=>void; compact?:boolean }) {
  return <div className={`reading-mode-switch${compact?' reading-mode-compact':''}`} role="group" aria-label="解读方式">
    {(['professional','plain'] as const).map(mode=>{const Icon=mode==='professional'?BookOpenText:MessageCircle;return <button type="button" key={mode} aria-label={mode==='professional'?'专业解读':'通俗解读'} aria-pressed={value===mode} onClick={()=>onChange(mode)}><Icon size={16} aria-hidden="true" />{mode==='professional'?(compact?'专业':'专业解读'):(compact?'通俗':'通俗解读')}</button>;})}
  </div>;
}
