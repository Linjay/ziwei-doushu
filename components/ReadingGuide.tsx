'use client';
import { useState } from 'react';
import { ChevronDown, Map, MousePointer2 } from 'lucide-react';
import type { ZiweiChart } from '@/lib/ziwei/types';
import type { InsightTopic } from '@/lib/insight-topics';
import { readingFocus, READING_FOCUS } from '@/lib/reading-focus';
import { TOPIC_ICONS } from './TopicIcons';

function MiniChart({chart,topic}:{chart:ZiweiChart;topic:InsightTopic}) {
  const focus=readingFocus(chart,topic);const Icon=TOPIC_ICONS[topic];
  return <span className="reading-guide-mini" aria-hidden="true"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="28" className="guide-orbit" />
    {chart.palaces.map(p=>{const angle=(p.branch-3)*Math.PI/6;const active=focus.some(item=>item.palace.branch===p.branch);return <circle key={p.branch} cx={36+28*Math.cos(angle)} cy={36+28*Math.sin(angle)} r={active?3.5:2} className={active?'guide-dot-active':'guide-dot'} />;})}
  </svg><Icon size={23} /></span>;
}
function PalaceDiagram({chart,topic,label}:{chart:ZiweiChart;topic:InsightTopic;label:string}) {
  const focus=readingFocus(chart,topic);const [selected,setSelected]=useState(focus[0]?.palace.branch);
  const current=focus.find(item=>item.palace.branch===selected)||focus[0];
  if(!current)return null;
  const positions=[[180,38],[65,112],[295,112],[180,188]];
  const stars=current.palace.stars.filter(star=>star.type==='major');
  return <div className="reading-palace-diagram">
    <p className="reading-diagram-label">{label}</p>
    <svg className="reading-diagram-svg" viewBox="30 0 300 226" role="img" aria-label={`${label}：${focus.map(item=>`${item.relation}${item.palaceName}`).join('，')}。下面可选择宫位查看详情。`}>
      {focus.slice(1).map((item,index)=><line key={item.palace.branch} x1={180} y1={38} x2={positions[index+1][0]} y2={positions[index+1][1]} className="reading-guide-line" />)}
      {focus.map((item,index)=>{const [x,y]=positions[index];return <g key={item.palace.branch} data-selected={current.palace.branch===item.palace.branch}>
        <circle cx={x} cy={y} r={index===0?30:26} className="reading-guide-node" />
        <text x={x} y={y-1} textAnchor="middle" className="reading-guide-node-name">{item.palaceName}</text><text x={x} y={y+14} textAnchor="middle" className="reading-guide-node-role">{item.relation}</text>
      </g>;})}
    </svg>
    <div className="reading-palace-options" role="group" aria-label={`${label}选择宫位`}>{focus.map(item=><button key={item.palace.branch} type="button" aria-pressed={current.palace.branch===item.palace.branch} onClick={()=>setSelected(item.palace.branch)}><strong>{item.palaceName}</strong><span>{item.meaning}</span></button>)}</div>
    <div className="reading-palace-facts" role="status"><strong>{current.palaceName} · {current.meaning}</strong><p>本盘主星：{stars.length?stars.map(star=>`${star.name}${star.brightnessRaw?`（${star.brightnessRaw}${star.siHua?` · 化${star.siHua}`:''}）`:star.siHua?`（化${star.siHua}）`:''}`).join('、'):'无主星'}。</p>
      {!stars.length&&current.palace.borrowedStars?.length?<p>记录中的借星：{current.palace.borrowedStars.join('、')}，参考{current.palace.borrowedFromName||'对宫'}。</p>:null}
    </div>
  </div>;
}
export default function ReadingGuide({chart,topic,chartB}:{chart:ZiweiChart;topic:InsightTopic;chartB?:ZiweiChart}) {
  const focus=readingFocus(chart,topic);if(!focus.length)return null;
  return <details className="reading-guide" data-topic={topic}>
    <summary><span className={chartB?'reading-guide-pair':''}><MiniChart chart={chart} topic={topic} />{chartB&&<MiniChart chart={chartB} topic={topic} />}</span><span className="reading-guide-summary"><strong>{chartB?'双方命盘':READING_FOCUS[topic].label} · 图解导览</strong><span>{chartB?'对照甲乙方的宫位与主星':`从${focus[0].palaceName}出发，看相关宫位的联系`}</span><small><Map size={12} aria-hidden="true" /><span className="reading-guide-open-label">展开图解</span><span className="reading-guide-close-label">收起图解</span></small></span><ChevronDown size={16} className="reading-guide-chevron" aria-hidden="true" /></summary>
    <div className="reading-guide-content"><p className="reading-guide-instruction"><MousePointer2 size={14} aria-hidden="true" />点选宫位，看它对应的生活领域与本盘主星。</p>
      <div className={chartB?'reading-guide-parts reading-guide-parts-pair':'reading-guide-parts'}><PalaceDiagram chart={chart} topic={topic} label={chartB?`甲方 · ${chart.birthInfo.name||'未命名'}`:`${READING_FOCUS[topic].label}主题 · 三方四正`} />{chartB&&<PalaceDiagram chart={chartB} topic={topic} label={`乙方 · ${chartB.birthInfo.name||'未命名'}`} />}</div>
      <p className="reading-guide-note">图示来自这份记录保存的命盘。“三合”与“对宫”表示排盘中一起参考的位置，连线表示宫位联系；请结合下方解读理解。</p>
    </div>
  </details>;
}
