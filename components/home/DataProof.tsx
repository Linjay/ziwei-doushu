import { ArrowRight, BookOpen, Database, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { HOME_FACTS } from '@/lib/home-facts';

export default function DataProof() {
  return <section id="data" className="home-data-section home-container home-section" aria-labelledby="home-data-title">
    <div className="home-section-heading" data-home-reveal>
      <div><p className="home-eyebrow">THE DEPTH BEHIND YOUR CHART</p><h2 id="home-data-title">百万级资料，<br /><em>落到你的这一张盘。</em></h2></div>
      <p>资料规模、覆盖范围、解读出处，都可以说清楚。<br />从同盘参考到古籍引文，让每次探索有迹可循。</p>
    </div>
    <div className="home-data-grid">
      <article className="home-data-card home-data-samples" data-home-reveal>
        <span className="home-data-label"><Database size={18} aria-hidden="true" />两版公开样本，完整接入检索</span>
        <strong className="home-data-total">{HOME_FACTS.validSamples.toLocaleString('en-US')}<small>条有效版本样本</small></strong>
        <div className="home-version-list">{HOME_FACTS.versions.map(version=><div key={version.name}>
          <div><span>{version.name}</span><strong>{version.count.toLocaleString('en-US')}<small>条</small></strong><b>{version.years}</b></div>
          <p>{version.note}</p>
        </div>)}</div>
        <p className="home-data-footnote">两版存在重合，合计数是版本样本数。年份跨度不代表逐日连续覆盖；未覆盖的生日不保证有同盘样本。</p>
      </article>
      <article className="home-data-card" data-home-reveal>
        <span className="home-data-label"><Sparkles size={18} aria-hidden="true" />不只一个笼统结论</span>
        <h3>{HOME_FACTS.sampleDimensions} 维参考资料</h3><p>从性格、感情、事业，延伸到家庭、人际与生活安排，按问题寻找相关解读。</p>
        <div className="home-data-topics" aria-label="样本资料的十三个维度">{HOME_FACTS.topics.map(topic=><span key={topic}>{topic}</span>)}</div>
        <p className="home-data-footnote">当前单盘提供六个独立主题入口；13 维指样本资料范围，也可围绕其他问题继续追问。</p>
      </article>
      <article className="home-data-card" data-home-reveal>
        <span className="home-data-label"><BookOpen size={18} aria-hidden="true" />样本之外，还有文献参照</span>
        <h3>{HOME_FACTS.literaturePassages.toLocaleString('en-US')} 段文献资料</h3>
        <div className="home-literature-counts"><div><strong>{HOME_FACTS.classicPassages}</strong><span>段古籍精选整理</span></div><div><strong>{HOME_FACTS.tianjiPassages.toLocaleString('en-US')}</strong><span>条《天纪》有出处引文</span></div></div>
        <p>《紫微斗数全书》《紫微斗数全集》《骨髓赋》精选整理，配合带讲次、时间码的《天纪》短引文。解读中的资料引用可打开原始条目。</p>
        <Link href="/library" className="home-text-link">查看古籍整理<ArrowRight size={16} aria-hidden="true" /></Link>
      </article>
    </div>
    <div className="home-data-method" data-home-reveal><Search size={22} aria-hidden="true" /><div><h3>大资料库，精确到与你相关的部分。</h3><p>先按排盘日、时辰与性别匹配样本，再检索相关文献节选。当前排盘优先，引用能回看；专业版保留依据，通俗版解释术语与生活场景。</p></div><span>资料盘点<br /><time dateTime={HOME_FACTS.verifiedOn}>{HOME_FACTS.verifiedOn}</time></span></div>
  </section>;
}
