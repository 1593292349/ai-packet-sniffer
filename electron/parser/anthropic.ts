import type { ParsedMessage } from './types';
import { asString } from './sse';

/**
 * 解析 Anthropic Messages（/v1/messages）请求里的输入消息
 */
export function extractInput(reqJson: any): ParsedMessage[] {
  if (!reqJson) return [];
  const out: ParsedMessage[] = [];

  if (typeof reqJson.system === 'string') {
    out.push({ role: 'system', content: reqJson.system });
  } else if (Array.isArray(reqJson.system)) {
    out.push({
      role: 'system',
      content: reqJson.system.map((s: any) => s.text || '').join('\n'),
    });
  }

  if (Array.isArray(reqJson.messages)) {
    for (const m of reqJson.messages) {
      if (typeof m?.content === 'string') {
        out.push({ role: m.role || 'user', content: m.content });
      } else if (Array.isArray(m?.content)) {
        const parts: string[] = [];
        const flushText = () => {
          if (parts.length) {
            out.push({ role: m.role || 'user', content: parts.join('\n') });
            parts.length = 0;
          }
        };
        for (const b of m.content) {
          if (b?.type === 'text') parts.push(b.text || '');
          else if (b?.type === 'image') parts.push(`[图片] ${asString(b.source)}`);
          else if (b?.type === 'tool_use') {
            flushText();
            out.push({
              role: m.role || 'assistant',
              content: `[tool_use] ${b.name}(${asString(b.input)})`,
              meta: { name: b.name, id: b.id },
            });
          } else if (b?.type === 'tool_result') {
            flushText();
            const c = typeof b.content === 'string' ? b.content : asString(b.content);
            out.push({
              role: 'tool',
              content: `[tool_result] ${c}`,
              meta: { tool_use_id: b.tool_use_id },
            });
          } else {
            parts.push(asString(b));
          }
        }
        flushText();
      }
    }
  }
  return out;
}

/**
 * 解析非流式响应
 */
export function parseNonStream(respJson: any): {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
} {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  let text = '';
  if (Array.isArray(respJson.content)) {
    for (const b of respJson.content) if (b.type === 'text') text += b.text || '';
  }
  return {
    text,
    model: respJson.model,
    inputTokens: respJson.usage?.input_tokens,
    outputTokens: respJson.usage?.output_tokens,
  };
}

/**
 * 解析 SSE 流。Anthropic 的 token 统计可能出现在：
 *  - message_start.message.usage（input_tokens）
 *  - message_delta.usage（output_tokens）
 */
export function parseStream(events: { event?: string; data: string }[]): {
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
    if (j.message?.model) model = j.message.model;
    if (j.message?.usage) {
      inputTokens = j.message.usage.input_tokens ?? inputTokens;
      outputTokens = j.message.usage.output_tokens ?? outputTokens;
    }
    if (j.usage) {
      inputTokens = j.usage.input_tokens ?? inputTokens;
      outputTokens = j.usage.output_tokens ?? outputTokens;
    }
    if (j.type === 'content_block_start' && j.content_block?.type === 'text') {
      text += j.content_block.text || '';
    } else if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
      text += j.delta.text || '';
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