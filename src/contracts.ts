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
export const editSchema = z.object({ revision: z.number().int(), values: valuesSchema, reason: z.string().trim().min(1).max(700), content: contentSchema.optional() });
export const reviewSchema = z.object({
  revision: z.number().int(),
  confirmed: z.object({ title: z.literal(true), time: z.literal(true), location: z.literal(true), registration: z.literal(true) }),
  contentConfirmed: z.literal(true),
});
export const feedbackSchema = z.object({ outcome: z.enum(['helped', 'partly', 'not_helped']) });

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
  contentChanges?: { at: string; field: keyof ReviewedContent; before: string; after: string; reason: string }[];
  changes: { at: string; field: Field; before: string; after: string; reason: string }[];
  audit?: Audit; review?: { at: string; revision: number; fields: Field[]; contentConfirmed: true };
  feedback?: { at: string; outcome: z.infer<typeof feedbackSchema>['outcome'] };
  provider?: { name: string; model: string | null; promptVersion: string; requests: number; elapsedMs: number; usage: unknown; timeoutMs?: number; reasoningEffort?: ReasoningEffort | null; maxTokens?: number };
  error?: string;
  controller: AbortController;
}
export type PublicTask = Omit<Task, 'session' | 'controller'>;
