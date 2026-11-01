/** Public corpus inventory, verified against the NAS index on 2026-11-01.
 * Update with the inventory evidence whenever rebuilding or replacing the corpus. */
export const HOME_FACTS = {
  verifiedOn: '2026-11-01',
  validSamples: 1_190_856,
  sampleDimensions: 13,
  versions: [
    { name: 'v3.0', count: 515_880, years: '1924–1983', note: '已排除 2,520 条不存在日期的样本；原版不含每月 31 日。' },
    { name: 'v4.0', count: 674_976, years: '1950–2026', note: '覆盖范围内的真实日期，包含 12 时辰与男女两种排盘条件。' },
  ],
  classicPassages: 75,
  tianjiPassages: 1_848,
  literaturePassages: 1_923,
  topics: ['命格总览','性格','感情婚姻','事业','财运','健康','兄弟合伙','子女','迁移','人际','田宅','福德','父母'],
} as const;
