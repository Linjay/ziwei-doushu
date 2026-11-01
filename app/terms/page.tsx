export const metadata = { title: '使用说明 · 紫微命盘' };
export default function TermsPage() {
  return <main className="account-shell"><article className="account-card account-form">
    <h1 style={{ fontSize: 28, fontWeight: 700 }}>使用说明</h1><p className="muted">更新于 2026 年 11 月 1 日 · 个人 NAS 学习工具</p>
    <h2>服务内容</h2><p>本服务提供紫微斗数排盘、联网 AI 解读、个人档案和账号历史。解读用于传统文化学习与自我观察，不是对未来事件的验证，也不构成医疗、投资或其他重大决策建议。</p>
    <h2>账号与历史</h2><p>请妥善保管账号密码。单盘与双人合盘、全部主题解读和追问按账号保存，可通过 JSON 导出备份和导入恢复；合盘保存双方出生信息及命盘，仅所属账号可查看。单个账号的单盘与合盘记录合计最多 1000 条，单次导入文件上限为 20 MB。含独立主题的备份为版本 3，也兼容旧单盘版本 1 和合盘版本 2；请使用新版恢复全部主题。请在删除或整理前保留所需备份。</p>
    <h2>AI 的使用</h2><p>AI 可能生成不准确内容，请核对出生信息和命盘依据，理性看待解读。服务同时最多运行两个解读任务；每个账号每小时最多发起 60 次解读，达到额度或并发限制时请稍后重试。请勿滥用接口或提交无关敏感信息。</p>
    <h2>来源与许可</h2><p>排盘引擎来自 <a href="https://github.com/Renhuai123/ziwei-doushu">Renhuai123/ziwei-doushu</a>，作者王多鱼AI。代码按上游 MIT 许可使用；公开数据另按 CC BY 4.0 处理，倪海厦《天纪》原话及相关引文适用 CC BY-NC-SA 4.0，排除在数据集 CC BY 授权之外。本部署的资料检索用于个人非商业学习，保留署名、定位和单独许可；不能据此将混合资料整体用于商用。切换商用模式会排除《天纪》和混合授权的 v3/v4 正文。本服务增加了独立的账号、历史与检索功能，并非上游线上商用版。</p>
    <p><a href="/privacy">隐私说明</a> · <a href="/chart">返回命盘</a></p>
  </article></main>;
}
