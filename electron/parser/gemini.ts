import type { ParsedMessage, ParsedResponse } from './types';
import { asString } from './sse';

function parseParts(parts: any[], role: 'user' | 'assistant'): {
  messages: ParsedMessage[];
  text: string;
  reasoning: string;
  hasTools: boolean;
} {
  const messages: ParsedMessage[] = [];
  let content: string[] = [];
  let reasoningParts: string[] = [];
  let text = '';
  let reasoning = '';
  let hasTools = false;
  let mode: 'text' | 'reasoning' | null = null;
  const flushText = () => {
    if (!content.length && !reasoningParts.length) return;
    messages.push({
      role,
      content: content.join('\n'),
      meta: reasoningParts.length ? { reasoning: reasoningParts.join('\n') } : undefined,
    });
    content = [];
    reasoningParts = [];
    mode = null;
  };
  const useMode = (nextMode: 'text' | 'reasoning') => {
    if (mode && mode !== nextMode) flushText();
    mode = nextMode;
  };

  for (const part of parts) {
    if (typeof part?.text === 'string') {
      if (part.thought) {
        useMode('reasoning');
        reasoning += part.text;
        reasoningParts.push(part.text);
      } else {
        useMode('text');
        text += part.text;
        content.push(part.text);
      }
    } else if (part?.functionCall) {
      hasTools = true;
      flushText();
      const name = part.functionCall.name || '';
      const args = asString(part.functionCall.args);
      messages.push({
        role: 'assistant',
        content: args ? `[tool_use] ${name}\n${args}` : `[tool_use] ${name}`,
        meta: { name, id: part.functionCall.id, call_id: part.functionCall.id, args },
      });
    } else if (part?.functionResponse) {
      hasTools = true;
      flushText();
      messages.push({
        role: 'tool',
        content: `[tool_result] ${asString(part.functionResponse.response)}`,
        meta: {
          name: part.functionResponse.name,
          call_id: part.functionResponse.id,
        },
      });
    } else if (part?.inlineData) {
      useMode('text');
      content.push(`[内联数据] ${part.inlineData.mimeType || ''}`.trim());
    } else if (part?.fileData) {
      useMode('text');
      content.push(`[文件] ${part.fileData.fileUri || part.fileData.mimeType || ''}`.trim());
    } else if (part?.thoughtSignature) {
      continue;
    } else {
      useMode('text');
      content.push(asString(part));
    }
  }
  flushText();
  return { messages, text, reasoning, hasTools };
}

function appendMessages(target: ParsedMessage[], incoming: ParsedMessage[]) {
  for (const message of incoming) {
    const last = target[target.length - 1];
    const messageIsText = message.role === 'assistant' && !message.meta?.name;
    const lastIsText = last?.role === 'assistant' && !last.meta?.name;
    const sameKind = Boolean(message.meta?.reasoning) === Boolean(last?.meta?.reasoning);
    if (messageIsText && lastIsText && sameKind) {
      last.content += message.content;
      const nextReasoning = message.meta?.reasoning;
      if (nextReasoning) {
        last.meta = { ...(last.meta || {}), reasoning: `${last.meta?.reasoning || ''}${nextReasoning}` };
      }
    } else {
      target.push(message);
    }
  }
}

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
      if (!Array.isArray(c?.parts)) {
        out.push({ role, content: asString(c) });
        continue;
      }
      out.push(...parseParts(c.parts, role).messages);
    }
  }
  return out;
}

export function parseNonStream(respJson: any): ParsedResponse {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  const cands = respJson.candidates || [];
  let text = '';
  let reasoning = '';
  let hasTools = false;
  const messages: ParsedMessage[] = [];
  for (const c of cands) {
    const parts = c?.content?.parts || [];
    const parsed = parseParts(parts, 'assistant');
    text += parsed.text;
    reasoning += parsed.reasoning;
    hasTools ||= parsed.hasTools;
    appendMessages(messages, parsed.messages);
  }
  return {
    text,
    reasoning: reasoning || undefined,
    messages: hasTools || messages.length > 1 ? messages : undefined,
    model: respJson.modelVersion,
    inputTokens: respJson.usageMetadata?.promptTokenCount,
    outputTokens: respJson.usageMetadata?.candidatesTokenCount,
  };
}

export function parseStream(events: { data: string }[]): ParsedResponse {
  let text = '';
  let reasoning = '';
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let hasTools = false;
  const messages: ParsedMessage[] = [];
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
      const parsed = parseParts(parts, 'assistant');
      text += parsed.text;
      reasoning += parsed.reasoning;
      hasTools ||= parsed.hasTools;
      appendMessages(messages, parsed.messages);
    }
  }
  return {
    text,
    reasoning: reasoning || undefined,
    messages: hasTools || messages.length > 1 ? messages : undefined,
    model,
    inputTokens,
    outputTokens,
  };
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}