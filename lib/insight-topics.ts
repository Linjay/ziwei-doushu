import type { ChartRecord, InsightMessage, InsightPhase, SavedInsight } from './chart-history';
import type { ReadingMode } from './reading-modes';

export const INSIGHT_TOPICS = ['overview', 'love', 'career', 'wealth', 'health', 'personality'] as const;
export type InsightTopic = typeof INSIGHT_TOPICS[number];
export interface TopicConversation { messages: InsightMessage[]; phase: InsightPhase; updatedAt: number }
export type TopicConversations = Partial<Record<InsightTopic, TopicConversation>>;
export function isInsightTopic(value: string): value is InsightTopic { return (INSIGHT_TOPICS as readonly string[]).includes(value); }
export function emptyTopic(): TopicConversation { return { messages: [], phase: 'idle', updatedAt: 0 }; }

const LEGACY_STARTS: [InsightTopic, string][] = [
  ['overview', '请生成命格总览'], ['love', '请深度分析感情婚姻运'], ['career', '请深度分析事业运'],
  ['wealth', '请深度分析财运'], ['health', '请分析健康运势'], ['personality', '请深度解析性格特质'],
];

/** Split only explicit legacy topic prompts. Never guess the subject of free text. */
export function topicConversations(insight: SavedInsight, updatedAt = 0): TopicConversations {
  if (insight.topics !== undefined) return insight.topics;
  const result: TopicConversations = {};
  const fallback = isInsightTopic(insight.activeTopic) ? insight.activeTopic : 'overview';
  let topic = fallback;
  for (const message of insight.messages) {
    if (message.role === 'user' && message.hidden) {
      const marker = LEGACY_STARTS.find(([, prefix]) => message.content.startsWith(prefix));
      if (marker) topic = marker[0];
    }
    const conversation = result[topic] ??= emptyTopic();
    conversation.messages.push(message);
  }
  for (const key of INSIGHT_TOPICS) {
    const conversation = result[key]; if (!conversation) continue;
    conversation.phase = key === fallback ? insight.phase
      : conversation.messages.some(message => message.role === 'assistant' && message.content) ? 'complete' : 'interrupted';
    conversation.updatedAt = key === fallback ? updatedAt : 0;
  }
  return result;
}
export function projectInsight(topics: TopicConversations, activeTopic: InsightTopic, modes?: Pick<SavedInsight,'plainTopics'|'readingMode'>): SavedInsight {
  const conversation = topics[activeTopic] || emptyTopic();
  return { messages: conversation.messages, activeTopic, phase: conversation.phase, topics, ...modes };
}
export function comparisonProfessional(insight: SavedInsight, fallback = 0): TopicConversation {
  return { messages:insight.messages,phase:insight.phase,updatedAt:insight.professionalUpdatedAt ?? fallback };
}
export function projectComparison(professional: TopicConversation, plainTopics: TopicConversations, mode: ReadingMode): SavedInsight {
  return { messages:professional.messages,phase:professional.phase,activeTopic:'overview',professionalUpdatedAt:professional.updatedAt,plainTopics,readingMode:mode };
}
export function restoreInsight(insight: SavedInsight): SavedInsight {
  const restore = (conversation: { messages: InsightMessage[]; phase: InsightPhase }) => conversation.phase === 'running'
    ? { ...conversation, phase: 'interrupted' as const, messages: conversation.messages.filter(m => m.role !== 'assistant' || m.content.length > 0) }
    : conversation;
  const plainTopics: TopicConversations = {};
  for (const key of INSIGHT_TOPICS) if (insight.plainTopics?.[key]) plainTopics[key] = { ...insight.plainTopics[key]!, ...restore(insight.plainTopics[key]!) };
  const modes = insight.plainTopics === undefined ? undefined : { plainTopics,readingMode:insight.readingMode };
  if (insight.topics === undefined) return { ...insight, ...restore(insight),...modes };
  const topics: TopicConversations = {};
  for (const key of INSIGHT_TOPICS) if (insight.topics[key]) topics[key] = { ...insight.topics[key]!, ...restore(insight.topics[key]!) };
  return projectInsight(topics, insight.activeTopic as InsightTopic,modes);
}
export function insightMessages(insight: SavedInsight): InsightMessage[] {
  const professional = insight.topics === undefined ? insight.messages : INSIGHT_TOPICS.flatMap(key => insight.topics![key]?.messages || []);
  return [...professional,...INSIGHT_TOPICS.flatMap(key => insight.plainTopics?.[key]?.messages || [])];
}
/** A tab switch never edits another topic's clock or conversation. */
export function mergeTopics(previous: TopicConversations, incoming: TopicConversations): TopicConversations {
  const merged: TopicConversations = {};
  for (const key of INSIGHT_TOPICS) {
    const a = previous[key]; const b = incoming[key];
    const selected = !a || (b && b.updatedAt > a.updatedAt) ? b : a;
    if (selected) merged[key] = selected;
  }
  return merged;
}
/** Preserve independent topic updates even when a different tab has a newer record timestamp. */
export function mergeTopicRecords(previous: ChartRecord, incoming: ChartRecord): ChartRecord {
  const latest = incoming.updatedAt >= previous.updatedAt ? incoming : previous;
  if ((previous.kind || 'single') !== (incoming.kind || 'single')) return latest;
  const hasModes = previous.insight.plainTopics !== undefined || incoming.insight.plainTopics !== undefined;
  if (previous.kind === 'comparison' && incoming.kind === 'comparison') {
    if (!hasModes) return latest;
    const a=comparisonProfessional(previous.insight,previous.updatedAt),b=comparisonProfessional(incoming.insight,incoming.updatedAt);
    const professional=b.updatedAt>a.updatedAt?b:a;
    return {...latest,insight:projectComparison(professional,mergeTopics(previous.insight.plainTopics||{},incoming.insight.plainTopics||{}),latest.insight.readingMode||'professional')};
  }
  if (previous.insight.topics === undefined && incoming.insight.topics === undefined && !hasModes) return latest;
  const topics = mergeTopics(topicConversations(previous.insight, previous.updatedAt), topicConversations(incoming.insight, incoming.updatedAt));
  const modes=hasModes?{plainTopics:mergeTopics(previous.insight.plainTopics||{},incoming.insight.plainTopics||{}),readingMode:latest.insight.readingMode||'professional' as const}:undefined;
  return { ...latest, insight: projectInsight(topics, latest.insight.activeTopic as InsightTopic,modes) };
}
/** View selection and per-topic clocks do not turn identical backups into conflicts. */
export function insightContent(insight: SavedInsight, comparison = false) {
  const topics: TopicConversations = comparison ? {overview:comparisonProfessional(insight)} : topicConversations(insight);
  const professional = Object.fromEntries(INSIGHT_TOPICS.filter(key => topics[key]).map(key => [key, {
    messages: topics[key]!.messages, phase: topics[key]!.phase,
  }]));
  const plain=Object.fromEntries(INSIGHT_TOPICS.filter(key=>insight.plainTopics?.[key]).map(key=>[key,{messages:insight.plainTopics![key]!.messages,phase:insight.plainTopics![key]!.phase}]));
  return Object.keys(plain).length?{professional,plain}:professional;
}
