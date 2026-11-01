import type { InsightMessage, InsightPhase } from './chart-history';

export const READING_MODES = ['professional', 'plain'] as const;
export type ReadingMode = typeof READING_MODES[number];
export function isReadingMode(value: unknown): value is ReadingMode { return READING_MODES.includes(value as ReadingMode); }
export const readingKey = (mode: ReadingMode, topic: string) => `${mode}:${topic}`;
export interface ProfessionalReference { text: string; phase: InsightPhase }
/** Old citation numbers belong to another retrieval, so never reuse them as new source IDs. */
export function professionalReference(messages: InsightMessage[], phase: InsightPhase): ProfessionalReference | undefined {
  const text = messages.filter(message => message.role === 'assistant' && message.content.trim())
    .map(message => message.content.split(/(?:\*\*)?【本次检索资料】(?:\*\*)?/)[0].replace(/\[资料\d+\](?:\([^)]*\))?/g,''))
    .join('\n\n').slice(-12000).trim();
  return text ? { text, phase } : undefined;
}
