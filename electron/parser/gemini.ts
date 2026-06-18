import type { ParsedMessage } from './types';
import { asString } from './sse';

/**
 * 解析 Gemini generateContent / streamGenerateContent 请求里的输入消息
 */
export function extractInput(reqJson: any): ParsedMessage[] {
  if (!reqJson) return [];
  const out: ParsedMessage[] = [];

  if (typeof reqJson.systemInstruction === 'string') {
    out.push({ role: 'system', content: reqJson.systemInstruction });
  } else if (reqJson.systemInstruction?.parts) {
    out.push({
      role: 'system',
      content: reqJson.systemInstruction.parts.map((p: any) => p.text || '').join('\n'),
    });
  }

  if (Array.isArray(reqJson.contents)) {
    for (const c of reqJson.contents) {
      const role = c.role === 'model' ? 'assistant' : 'user';
      if (typeof c?.parts?.[0]?.text === 'string') {
        out.push({ role, content: c.parts.map((p: any) => p.text || '').join('\n') });
      } else {
        out.push({ role, content: asString(c) });
      }
    }
  }
  return out;
}

export function parseNonStream(respJson: any): {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
} {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  const cands = respJson.candidates || [];
  let text = '';
  for (const c of cands) {
    const parts = c?.content?.parts || [];
    for (const p of parts) if (p.text) text += p.text;
  }
  return {
    text,
    model: respJson.modelVersion,
    inputTokens: respJson.usageMetadata?.promptTokenCount,
    outputTokens: respJson.usageMetadata?.candidatesTokenCount,
  };
}

export function parseStream(events: { data: string }[]): {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
} {
  let text = '';
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const e of events) {
    const j = safeParse(e.data);
    if (!j) continue;
    if (j.modelVersion) model = j.modelVersion;
    if (j.usageMetadata) {
      inputTokens = j.usageMetadata.promptTokenCount ?? inputTokens;
      outputTokens = j.usageMetadata.candidatesTokenCount ?? outputTokens;
    }
    const cands = j.candidates || [];
    for (const c of cands) {
      const parts = c?.content?.parts || [];
      for (const p of parts) if (p.text) text += p.text;
    }
  }
  return { text, model, inputTokens, outputTokens };
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}