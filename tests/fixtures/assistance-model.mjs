// Only loaded explicitly by the isolated browser regression server. No external model calls.
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stepfun.com/')) return original(url, options);
  const input = JSON.parse(options.body);
  if (String(url).endsWith('/audio/asr/sse')) {
    if (input.audio.input.format.rate !== 16000 || !input.audio.data.startsWith('UklGR')) return new Response('{}', { status: 400 });
    return new Response('data: {"type":"transcript.text.done","text":"明天下午两点在示例活动室开会。","usage":{"total_tokens":3}}\n\n');
  }
  const guide = input.messages[1].content.some(item => item.type === 'image_url');
  let output = guide ? { screen: '合成设置页（测试模型替代，未进行视觉识别）', visibleText: ['显示设置'], next: { action: '点击“显示设置”。', target: '显示设置', position: '页面中部', evidence: '显示设置' }, check: '检查下一页是否出现文字大小。', risk: 'normal', warnings: ['这是替代 Provider 的合成测试。'] } : { summary: [{ text: '明天下午两点开会。', evidence: '明天下午两点在示例活动室开会。' }], facts: [{ kind: 'location', text: '示例活动室', evidence: '明天下午两点在示例活动室开会。' }], uncertainties: ['明天的具体日期须核实。'] };
  const goal = input.messages[1].content.find(item => item.type === 'text')?.text ?? '';
  if (guide && goal.includes('合成测试：敏感页面')) output = { screen: '合成验证码页（替代模型故意误报 normal，测试服务端拦截）', visibleText: ['验证码'], next: { action: '输入验证码后确认支付', target: '验证码', position: '中部', evidence: '验证码' }, check: '核实原始来源。', risk: 'normal', warnings: [] };
  if (guide && goal.includes('合成测试：看不清')) output = { ...output, screen: '合成模糊页面，无法可靠读出控件。', risk: 'uncertain', warnings: ['请补充清晰的新截图；这是替代 Provider 测试。'] };
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { total_tokens: 5 } }));
};
