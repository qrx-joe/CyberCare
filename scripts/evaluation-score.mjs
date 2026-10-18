const fields = ['title', 'time', 'location', 'registration'];
const normalize = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, '') : value;

// Conservative string comparison, not an LLM judging its own answers or a semantic accuracy claim.
export function scoreFacts(expected, actual) {
  const results = fields.map(field => {
    const gold = expected[field], observed = actual[field]?.value ?? null;
    if (gold === null) return { field, expected: gold, actual: observed, outcome: observed === null ? 'unknown-preserved' : 'invented-known' };
    return { field, expected: gold, actual: observed, outcome: observed === null ? 'omitted-known' : normalize(gold) === normalize(observed) ? 'known-match' : 'known-mismatch' };
  });
  return { results, counts: Object.fromEntries(['known-match', 'known-mismatch', 'omitted-known', 'unknown-preserved', 'invented-known'].map(outcome => [outcome, results.filter(result => result.outcome === outcome).length])) };
}
