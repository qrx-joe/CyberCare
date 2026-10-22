import { z } from 'zod';

export const FIELDS = {
  title: '活动名称', time: '活动时间', location: '活动地点', registration: '报名方式',
} as const;
export type Field = keyof typeof FIELDS;
export type ReasoningEffort = 'low' | 'medium' | 'high';
export const fieldKeys = Object.keys(FIELDS) as Field[];
export const factSchema = z.object({ value: z.string().max(500).nullable(), evidence: z.string().max(700) });
export const timeReferenceSchema = z.object({
  kind: z.enum(['event', 'registration-deadline', 'submission-deadline', 'unknown']),
  value: z.string().min(1).max(500), evidence: z.string().min(1).max(700),
});
export type TimeReference = z.infer<typeof timeReferenceSchema>;
export type TimeKind = TimeReference['kind'];
export const extractionSchema = z.object({
  original: z.string().min(1).max(12000),
  summary: z.string().max(1500),
  description: z.string().max(1500),
  facts: z.object({ title: factSchema, time: factSchema, location: factSchema, registration: factSchema }),
  timeReferences: z.array(timeReferenceSchema).max(8).optional(),
  uncertainties: z.array(z.string().max(700)).max(30),
});
export type Extraction = z.infer<typeof extractionSchema>;
export const inputSchema = z.object({
  mode: z.enum(['sample', 'manual', 'live']),
  sourceNote: z.string().trim().min(1).max(500),
  permission: z.literal(true),
  text: z.string().max(12000).optional(),
  image: z.object({ name: z.string().max(150), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().max(2900000) }).optional(),
});
export type Input = z.infer<typeof inputSchema>;
const valuesSchema = z.object({ title: z.string().max(500), time: z.string().max(500), location: z.string().max(500), registration: z.string().max(500) });
export const contentSchema = z.object({
  original: z.string().trim().min(1).max(12000),
  summary: z.string().max(1500),
  description: z.string().max(1500),
});
export type ReviewedContent = z.infer<typeof contentSchema>;
export const summaryModeSchema = z.enum(['fields', 'custom']);
export type SummaryMode = z.infer<typeof summaryModeSchema>;
export const editSchema = z.object({ revision: z.number().int(), values: valuesSchema, reason: z.string().trim().min(1).max(700), content: contentSchema.optional(), summaryMode: summaryModeSchema.optional() });
export const reviewSchema = z.object({
  revision: z.number().int(),
  confirmed: z.object({ title: z.literal(true), time: z.literal(true), location: z.literal(true), registration: z.literal(true) }),
  contentConfirmed: z.literal(true),
});
export const feedbackSchema = z.object({ outcome: z.enum(['helped', 'partly', 'not_helped']) });
export const avatarAttemptSchema = z.object({ attemptId: z.string().uuid() });
export const narrationSchema = z.object({ revision: z.number().int(), permission: z.literal(true) });

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Audit {
  revision: number; htmlHash: string; at: string; engine: string;
  violations: { id: string; impact: string | null; help: string; nodes: number }[];
  incomplete: { id: string; help: string; nodes: number }[];
  passes: number;
}
export interface Task {
  id: string; session: string; status: 'processing' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
  revision: number; createdAt: string; expiresAt: string;
  source: { mode: Input['mode']; note: string; permission: string; sha256: string; fileName: string | null };
  extraction?: Extraction; values?: Record<Field, string>;
  reviewedContent?: ReviewedContent;
  summaryMode?: SummaryMode;
  summarySourceChanges?: { at: string; before: SummaryMode; after: SummaryMode; reason: string }[];
  contentChanges?: { at: string; field: keyof ReviewedContent; before: string; after: string; reason: string }[];
  changes: { at: string; field: Field; before: string; after: string; reason: string }[];
  audit?: Audit; review?: { at: string; revision: number; fields: Field[]; contentConfirmed: true };
  feedback?: { at: string; outcome: z.infer<typeof feedbackSchema>['outcome'] };
  provider?: { name: string; model: string | null; promptVersion: string; requests: number; elapsedMs: number; usage: unknown; timeoutMs?: number; reasoningEffort?: ReasoningEffort | null; maxTokens?: number };
  error?: string;
  controller: AbortController;
}
export interface BodyReviewHint {
  field: Field; kind: 'not-located' | 'unknown-retained'; current: string; previous?: string; reason: string;
}
export type PublicTask = Omit<Task, 'session' | 'controller'> & { bodyReview?: BodyReviewHint[] };

const assistanceSource = { sourceNote: z.string().trim().min(1).max(500), permission: z.literal(true) };
export const assistanceInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...assistanceSource, kind: z.literal('audio'), mode: z.enum(['sample', 'manual', 'live']), text: z.string().max(12000).optional(), audio: z.object({ name: z.string().max(150), data: z.string().max(2800000) }).optional() }),
  z.object({ ...assistanceSource, kind: z.literal('guide'), mode: z.enum(['sample', 'live']), goal: z.string().trim().min(1).max(300), image: inputSchema.shape.image, previousId: z.string().uuid().optional() }),
]);
export type AssistanceInput = z.infer<typeof assistanceInputSchema>;
const citedTextSchema = z.object({ text: z.string().trim().min(1).max(700), evidence: z.string().trim().min(1).max(1000) });
export const audioResultSchema = z.object({
  original: z.string().trim().min(1).max(12000), summary: z.array(citedTextSchema).max(8),
  facts: z.array(z.object({ kind: z.enum(['time', 'location', 'todo']), ...citedTextSchema.shape })).max(12),
  uncertainties: z.array(z.string().max(700)).max(20), summaryError: z.string().max(300).optional(),
});
export const guidanceResultSchema = z.object({
  screen: z.string().trim().min(1).max(700), visibleText: z.array(z.string().trim().min(1).max(200)).max(20),
  next: z.object({ action: z.string().trim().min(1).max(500), target: z.string().max(200), position: z.string().max(300), evidence: z.string().max(300) }).nullable(),
  check: z.string().trim().min(1).max(500), risk: z.enum(['normal', 'sensitive', 'uncertain']),
  warnings: z.array(z.string().max(700)).max(12),
});
export type AudioResult = z.infer<typeof audioResultSchema>;
export type GuidanceResult = z.infer<typeof guidanceResultSchema>;
export const assistanceReviewSchema = z.object({ revision: z.number().int().positive(), confirmed: z.literal(true), text: z.string().trim().min(1).max(12000).optional(), summary: z.string().max(6000).optional(), reason: z.string().max(700).optional() });
export const assistanceEditSchema = z.object({ revision: z.number().int().positive(), text: z.string().trim().min(1).max(12000), summary: z.string().max(6000), reason: z.string().trim().min(1).max(700) });
export interface AssistanceTask {
  id: string; kind: AssistanceInput['kind']; mode: AssistanceInput['mode']; session: string;
  status: 'processing' | 'needs_review' | 'completed' | 'failed' | 'cancelled'; revision: number;
  createdAt: string; expiresAt: string; sourceNote: string; sourceHash: string; goal?: string; previousId?: string;
  audio?: AudioResult; guidance?: GuidanceResult; error?: string;
  providers: { stage: string; model: string | null; usage: unknown; requests: number }[];
  reviewed?: { text: string; summary: string; reason: string; at: string };
  confirmedAt?: string; controller: AbortController;
}
export interface AudioReviewHint { kind: 'time' | 'location' | 'todo'; text: string; message: string; }
export type PublicAssistanceTask = Omit<AssistanceTask, 'session' | 'controller'> & { audioReviewHints?: AudioReviewHint[] };
