import { AIInline } from './AIInline';
import { BookOpenText, Compass, Lightbulb, MessagesSquare, Orbit } from 'lucide-react';

function Lines({ text }: { text: string }) {
  return <>{text.split('\n').map((line, index) => {
    const heading = /^(?:\*\*【(.+?)】\*\*|【(.+?)】|#{1,3}\s+(.+))$/.exec(line.trim());
    if (heading) { const title=heading[1]||heading[2]||heading[3];const Icon=/建议|尝试|预防/.test(title)?Compass:/生活|相处|沟通/.test(title)?MessagesSquare:/先说人话|优势|定性/.test(title)?Lightbulb:/宫|星|四化|格局|大限/.test(title)?Orbit:BookOpenText;return <h3 key={index}><Icon size={18} aria-hidden="true" /><span>{title}</span></h3>; }
    if (!line.trim()) return <div key={index} className="reading-gap" />;
    return <p key={index}>{line.split(/\*\*(.+?)\*\*/).map((part, i) => i % 2 ? <strong key={i}>{part}</strong> : <AIInline key={i} text={part} />)}</p>;
  })}</>;
}
export default function ReadingText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const footer = /(?:\*\*)?【本次检索资料】(?:\*\*)?/.exec(text);
  const body = footer ? text.slice(0, footer.index) : text;
  const references = footer ? text.slice(footer.index + footer[0].length) : '';
  const count = new Set(references.match(/\[资料\d+\]/g) || []).size;
  return <div className="reading-text"><Lines text={body} />
    {references && <details className="source-list"><summary>参考资料与出处{count ? `（${count}）` : ''}</summary><Lines text={references} /></details>}
    {streaming && <span className="stream-cursor" aria-hidden="true" />}
  </div>;
}
