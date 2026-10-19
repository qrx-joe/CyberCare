// Validate the whole batch before creating a report, opening a browser or using a provider.
export function evaluationPlan(args, cases) {
  const options = new Map();
  for (const arg of args) {
    let key, value;
    if (arg === '--live') { key = 'live'; value = true; }
    else if (/^--limit=[1-3]$/.test(arg)) { key = 'limit'; value = Number(arg.slice(8)); }
    else if (arg.startsWith('--cases=')) { key = 'cases'; value = arg.slice(8); }
    else throw new Error('仅支持 --live、--limit=1/2/3 与 --cases=样本ID列表；无自动重试。');
    if (options.has(key)) throw new Error('同一评估参数不能重复；请明确本批范围。');
    options.set(key, value);
  }
  const live = options.has('live'), limit = options.get('limit') ?? 3;
  const requestedCaseIds = options.has('cases') ? options.get('cases').split(',') : null;
  const byId = new Map(cases.map(sample => [sample.id, sample]));
  if (requestedCaseIds && (new Set(requestedCaseIds).size !== requestedCaseIds.length || requestedCaseIds.some(id => !byId.has(id)))) {
    throw new Error('样本 ID 必须已定义、非空且不重复；未开始评估。');
  }
  const samples = requestedCaseIds ? requestedCaseIds.map(id => byId.get(id)) : live ? cases.slice(0, limit) : cases;
  if (!samples.length) throw new Error('没有待评估样本；未开始评估。');
  if (live && samples.length > limit) throw new Error('所选样本数超过本批请求上限；不会截断样本或扩大预算。');
  if (live && samples.some(sample => sample.liveEligible === false)) throw new Error('所选样本含已停用的旧评估口径；qr-unknown 仅供离线复查，新视觉评估请选择 qr-instruction 或 qr-unlabeled。');
  return { live, limit, samples, requestedCaseIds };
}
