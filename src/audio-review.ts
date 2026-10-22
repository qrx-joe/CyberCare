import type { AudioResult, AudioReviewHint } from './contracts.js';

// Text comparison only: neither locating nor missing a phrase establishes its truth.
export function audioReviewHints(audio: AudioResult | undefined, text: string, summary: string): AudioReviewHint[] {
  if (!audio) return [];
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, '');
  const original = normalize(audio.original), current = normalize(text), digest = normalize(summary);
  const seen = new Set<string>();
  return audio.facts.flatMap(fact => {
    const value = normalize(fact.text), key = `${fact.kind}:${value}`;
    if (!value || seen.has(key) || !original.includes(value) || current.includes(value) || !digest.includes(value)) return [];
    seen.add(key);
    return [{ kind: fact.kind, text: fact.text, message: `摘要仍含“${fact.text}”，当前全文中未找到这段文字。请对照原音核对两处；这是文字对照提示，不判定哪一处正确。` }];
  });
}
