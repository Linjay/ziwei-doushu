import type { ZiweiChart } from './ziwei/types';
import type { InsightTopic } from './insight-topics';

export const READING_FOCUS = {
  overview: { label:'命格', palace:'命宫' },
  love: { label:'感情', palace:'夫妻宫' },
  career: { label:'事业', palace:'官禄宫' },
  wealth: { label:'财运', palace:'财帛宫' },
  health: { label:'健康', palace:'疾厄宫' },
  personality: { label:'性格', palace:'命宫' },
} as const satisfies Record<InsightTopic,{label:string;palace:string}>;
export const PALACE_MEANINGS:Record<string,string> = {
  '命宫':'自我与行动方式','兄弟宫':'手足与合作关系','夫妻宫':'亲密关系与相处','子女宫':'子女与照顾关系',
  '财帛宫':'收入与资源运用','疾厄宫':'生活习惯与身心照顾','迁移宫':'外部环境与变化','交友宫':'朋友与人际支持',
  '官禄宫':'工作与发展方式','田宅宫':'居住与生活基础','福德宫':'内心感受与满足','父母宫':'长辈与支持关系',
  '仆役宫':'朋友与人际支持',
};
/** Stored engine versions use both 夫妻 and 夫妻宫; preserve the snapshot itself. */
export const displayPalaceName=(name:string)=>name.endsWith('宫')?name:`${name}宫`;
/** Same branch offsets as the engine's three-harmony/opposite-palace relationships.
 * Read only the saved chart; never re-derive stars or modify historical snapshots. */
export function readingFocus(chart:ZiweiChart,topic:InsightTopic) {
  const primary=chart.palaces.find(p=>displayPalaceName(p.name)===READING_FOCUS[topic].palace);
  if(!primary)return [];
  return [0,4,8,6].flatMap((offset,index)=>{
    const palace=chart.palaces.find(p=>p.branch===(primary.branch+offset)%12);
    const palaceName=palace?displayPalaceName(palace.name):'';
    return palace?[{palace,palaceName,relation:index===0?'主题宫位':index===3?'对宫':'三合宫位',meaning:PALACE_MEANINGS[palaceName]||palaceName}]:[];
  });
}
