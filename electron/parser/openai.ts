import type { ParsedMessage } from './types';
import { asString } from './sse';

/**
 * 解析 OpenAI Chat Completions（/v1/chat/completions）请求里的输入消息
 */
export function extractChatInput(reqJson: any): ParsedMessage[] {
  if (!reqJson) return [];
  const out: ParsedMessage[] = [];

  if (reqJson.system) {
    out.unshift({ role: 'system', content: asString(reqJson.system) });
  }

  if (Array.isArray(reqJson.messages)) {
    for (const m of reqJson.messages) {
      if (typeof m?.content === 'string') {
        out.push({ role: m.role || 'user', content: m.content });
      } else if (Array.isArray(m?.content)) {
        // 多模态：拼成纯文本
        const parts = m.content
          .map((p: any) => {
            if (p?.type === 'text') return p.text;
            if (p?.type === 'image_url') return `[图片] ${p.image_url?.url || ''}`;
            return asString(p);
          })
          .filter(Boolean);
        out.push({ role: m.role || 'user', content: parts.join('\n') });
      }
    }
  }
  return out;
}

/**
 * 解析非流式 Chat 响应
 */
export function parseChatNonStream(respJson: any): {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
} {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  const ch = respJson.choices?.[0];
  const text = ch?.message?.content ?? ch?.text ?? '';
  return {
    text: asString(text),
    model: respJson.model,
    inputTokens: respJson.usage?.prompt_tokens,
    outputTokens: respJson.usage?.completion_tokens,
  };
}

/**
 * 解析流式 Chat SSE：把所有 delta.content 拼起来。
 * 兼容 reasoning_content（DeepSeek 等）
 */
export function parseChatStream(events: { data: string }[]): {
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
    if (e.data === '[DONE]') continue;
    const j = safeParse(e.data);
    if (!j) continue;
    if (j.model) model = j.model;
    if (j.usage) {
      inputTokens = j.usage.prompt_tokens ?? inputTokens;
      outputTokens = j.usage.completion_tokens ?? outputTokens;
    }
    const delta = j.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
    else if (delta?.reasoning_content) text += delta.reasoning_content;
  }
  return { text, model, inputTokens, outputTokens };
}

// ---------- OpenAI Responses (/v1/responses) ----------

export function extractResponsesInput(reqJson: any): ParsedMessage[] {
  if (!reqJson) return [];
  const out: ParsedMessage[] = [];

  if (typeof reqJson.instructions === 'string') {
    out.push({ role: 'system', content: reqJson.instructions });
  }

  if (typeof reqJson.input === 'string') {
    out.push({ role: 'user', content: reqJson.input });
  } else if (Array.isArray(reqJson.input)) {
    for (const item of reqJson.input) {
      if (typeof item === 'string') {
        out.push({ role: 'user', content: item });
      } else if (item && typeof item === 'object') {
        if (item.type === 'message') {
          const role = item.role || 'user';
          if (Array.isArray(item.content)) {
            const parts = item.content
              .map((p: any) => {
                if (p?.type === 'input_text' || p?.type === 'text') return p.text;
                if (p?.type === 'input_image') return `[图片] ${p.image_url || ''}`;
                if (p?.type === 'output_text') return p.text;
                return asString(p);
              })
              .filter(Boolean);
            out.push({ role, content: parts.join('\n') });
          } else if (typeof item.content === 'string') {
            out.push({ role, content: item.content });
          }
        } else if (item.type === 'function_call') {
          out.push({
            role: 'tool',
            content: `[tool_call] ${item.name || ''}(${asString(item.arguments)})`,
            meta: { name: item.name, call_id: item.call_id, arguments: item.arguments },
          });
        } else if (item.type === 'function_call_output') {
          out.push({
            role: 'tool',
            content: `[tool_result] ${asString(item.output)}`,
            meta: { call_id: item.call_id, output: item.output },
          });
        }
      }
    }
  }
  return out;
}

export function parseResponsesNonStream(respJson: any): {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
} {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  let text = '';
  const outs = respJson.output || [];
  for (const o of outs) {
    if (o.type === 'message' && Array.isArray(o.content)) {
      for (const c of o.content) if (c.type === 'output_text') text += c.text;
    }
  }
  return {
    text,
    model: respJson.model,
    inputTokens: respJson.usage?.input_tokens,
    outputTokens: respJson.usage?.output_tokens,
  };
}

export function parseResponsesStream(events: { data: string }[]): {
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
    if (j.model) model = j.model;
    if (j.type === 'response.output_text.delta' && j.delta) text += j.delta;
    if (j.usage) {
      inputTokens = j.usage.input_tokens ?? inputTokens;
      outputTokens = j.usage.output_tokens ?? outputTokens;
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