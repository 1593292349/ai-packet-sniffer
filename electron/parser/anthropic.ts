import type { ParsedMessage, ParsedResponse } from './types';
import { asString } from './sse';

function parseResponseBlocks(blocks: any[]): Pick<ParsedResponse, 'text' | 'reasoning' | 'messages'> {
  let text = '';
  let reasoning = '';
  let pendingText = '';
  let pendingReasoning = '';
  let hasTools = false;
  let mode: 'text' | 'reasoning' | null = null;
  const messages: ParsedMessage[] = [];
  const flushText = () => {
    if (!pendingText && !pendingReasoning) return;
    messages.push({
      role: 'assistant',
      content: pendingText,
      meta: pendingReasoning ? { reasoning: pendingReasoning } : undefined,
    });
    pendingText = '';
    pendingReasoning = '';
    mode = null;
  };
  const useMode = (nextMode: 'text' | 'reasoning') => {
    if (mode && mode !== nextMode) flushText();
    mode = nextMode;
  };

  for (const block of blocks) {
    if (block?.type === 'text') {
      useMode('text');
      const value = block.text || '';
      text += value;
      pendingText += value;
    } else if (block?.type === 'thinking') {
      useMode('reasoning');
      const value = block.thinking || '';
      reasoning += value;
      pendingReasoning += value;
    } else if (block?.type === 'tool_use') {
      hasTools = true;
      flushText();
      const args = formatToolArgs(block.input);
      messages.push({
        role: 'assistant',
        content: args ? `[tool_use] ${block.name || ''}\n${args}` : `[tool_use] ${block.name || ''}`,
        meta: { name: block.name, id: block.id, call_id: block.id, args },
      });
    } else if (block?.type === 'tool_result') {
      hasTools = true;
      flushText();
      messages.push({
        role: 'tool',
        content: typeof block.content === 'string' ? block.content : asString(block.content),
        meta: { tool_use_id: block.tool_use_id },
      });
    }
  }
  flushText();
  return {
    text,
    reasoning: reasoning || undefined,
    messages: hasTools || messages.length > 1 ? messages : undefined,
  };
}

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
        let reasoning = '';
        const flushText = () => {
          if (parts.length) {
            out.push({
              role: m.role || 'user',
              content: parts.join('\n'),
              meta: reasoning ? { reasoning } : undefined,
            });
            parts.length = 0;
            reasoning = '';
          }
        };
        for (const b of m.content) {
          if (b?.type === 'text') parts.push(b.text || '');
          else if (b?.type === 'thinking' && typeof b.thinking === 'string') {
            flushText();
            reasoning += b.thinking;
          }
          else if (b?.type === 'image') parts.push(`[图片] ${asString(b.source)}`);
          else if (b?.type === 'tool_use') {
            flushText();
            if (reasoning) {
              out.push({ role: 'assistant', content: '', meta: { reasoning } });
              reasoning = '';
            }
            const args = formatToolArgs(b.input);
            out.push({
              role: 'assistant',
              content: args ? `[tool_use] ${b.name}\n${args}` : `[tool_use] ${b.name}`,
              meta: { name: b.name, id: b.id, args },
            });
          } else if (b?.type === 'tool_result') {
            flushText();
            const c = typeof b.content === 'string' ? b.content : asString(b.content);
            const summary = c.length > 200 ? c.slice(0, 200) + '…' : c;
            out.push({
              role: 'tool',
              content: summary,
              meta: { tool_use_id: b.tool_use_id },
            });
          } else {
            parts.push(asString(b));
          }
        }
        flushText();
        if (reasoning) {
          out.push({ role: m.role || 'assistant', content: '', meta: { reasoning } });
        }
      }
    }
  }
  return out;
}

/**
 * 解析非流式响应
 */
export function parseNonStream(respJson: any): ParsedResponse {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  const parsed = parseResponseBlocks(Array.isArray(respJson.content) ? respJson.content : []);
  return {
    ...parsed,
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
export function parseStream(events: { event?: string; data: string }[]): ParsedResponse {
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const blocks = new Map<number, any>();
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
    if (j.type === 'content_block_start' && j.content_block) {
      const block = { ...j.content_block };
      if (block.type === 'tool_use') block._inputJson = '';
      blocks.set(j.index ?? blocks.size, block);
    } else if (j.type === 'content_block_delta') {
      const index = j.index ?? 0;
      const block = blocks.get(index) || {
        type: j.delta?.type === 'thinking_delta' ? 'thinking' : 'text',
      };
      if (j.delta?.type === 'text_delta') block.text = (block.text || '') + (j.delta.text || '');
      else if (j.delta?.type === 'thinking_delta') {
        block.thinking = (block.thinking || '') + (j.delta.thinking || '');
      } else if (j.delta?.type === 'input_json_delta') {
        block.type = 'tool_use';
        block._inputJson = (block._inputJson || '') + (j.delta.partial_json || '');
      }
      blocks.set(index, block);
    }
  }
  const orderedBlocks = Array.from(blocks.entries())
    .sort(([a], [b]) => a - b)
    .map(([, block]) => {
      if (block.type === 'tool_use' && block._inputJson) {
        block.input = safeParse(block._inputJson) ?? block._inputJson;
      }
      return block;
    });
  return { ...parseResponseBlocks(orderedBlocks), model, inputTokens, outputTokens };
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 把 tool_use 的参数转成人类可读格式，如 city: "北京", units: "celsius" */
function formatToolArgs(input: any): string {
  if (!input || typeof input !== 'object') return String(input ?? '');
  try {
    return Object.entries(input)
      .map(([k, v]) => {
        const vs = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
        return `${k}: ${vs}`;
      })
      .join(', ');
  } catch {
    return asString(input);
  }
}