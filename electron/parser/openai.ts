import type { ParsedMessage, ParsedResponse } from './types';
import { asString } from './sse';

function toolCallMessage(call: any): ParsedMessage {
  const fn = call?.function || call || {};
  const name = fn.name || call?.name || '';
  const rawArgs = fn.arguments ?? call?.arguments ?? call?.input ?? '';
  const args = typeof rawArgs === 'string' ? rawArgs : asString(rawArgs);
  return {
    role: 'assistant',
    content: args ? `[tool_use] ${name}\n${args}` : `[tool_use] ${name}`,
    meta: {
      name,
      args,
      id: call?.id,
      call_id: call?.call_id || call?.id,
    },
  };
}

function responseMessages(text: string, reasoning: string, calls: any[]): ParsedMessage[] | undefined {
  if (!calls.length) return undefined;
  const messages: ParsedMessage[] = [];
  if (text || reasoning) {
    messages.push({
      role: 'assistant',
      content: text,
      meta: reasoning ? { reasoning } : undefined,
    });
  }
  messages.push(...calls.map(toolCallMessage));
  return messages;
}

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
      const reasoning = typeof m?.reasoning_content === 'string' ? m.reasoning_content : '';
      const meta: Record<string, any> = {};
      if (reasoning) meta.reasoning = reasoning;
      if (m?.role === 'tool') {
        if (m.tool_call_id) meta.tool_call_id = m.tool_call_id;
        if (m.name) meta.name = m.name;
      }
      const messageMeta = Object.keys(meta).length ? meta : undefined;
      const calls = Array.isArray(m?.tool_calls) && m.tool_calls.length
        ? m.tool_calls
        : m?.function_call && typeof m.function_call === 'object'
          ? [m.function_call]
          : [];
      if (typeof m?.content === 'string') {
        if (m.content || messageMeta || !calls.length) {
          out.push({ role: m.role || 'user', content: m.content, meta: messageMeta });
        }
      } else if (Array.isArray(m?.content)) {
        // 多模态：拼成纯文本
        const parts = m.content
          .map((p: any) => {
            if (p?.type === 'text') return p.text;
            if (p?.type === 'image_url') return `[图片] ${p.image_url?.url || ''}`;
            return asString(p);
          })
          .filter(Boolean);
        const content = parts.join('\n');
        if (content || messageMeta || !calls.length) {
          out.push({ role: m.role || 'user', content, meta: messageMeta });
        }
      } else if (messageMeta) {
        out.push({ role: m.role || 'assistant', content: '', meta: messageMeta });
      }
      out.push(...calls.map(toolCallMessage));
    }
  }
  return out;
}

/**
 * 解析非流式 Chat 响应
 */
export function parseChatNonStream(respJson: any): ParsedResponse {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  const ch = respJson.choices?.[0];
  const text = ch?.message?.content ?? ch?.text ?? '';
  const normalizedText = asString(text);
  const reasoning = asString(ch?.message?.reasoning_content);
  const calls = Array.isArray(ch?.message?.tool_calls)
    ? ch.message.tool_calls
    : ch?.message?.function_call
      ? [ch.message.function_call]
      : [];
  return {
    text: normalizedText,
    reasoning: reasoning || undefined,
    messages: responseMessages(normalizedText, reasoning, calls),
    model: respJson.model,
    inputTokens: respJson.usage?.prompt_tokens,
    outputTokens: respJson.usage?.completion_tokens,
  };
}

/**
 * 解析流式 Chat SSE：分别拼接正文和 reasoning_content（DeepSeek 等兼容接口）。
 */
export function parseChatStream(events: { data: string }[]): ParsedResponse {
  let text = '';
  let reasoning = '';
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const calls: any[] = [];
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
    if (delta?.reasoning_content) reasoning += delta.reasoning_content;
    if (Array.isArray(delta?.tool_calls)) {
      for (const [position, part] of delta.tool_calls.entries()) {
        const index = part.index ?? position;
        const call = calls[index] || { function: { name: '', arguments: '' } };
        if (part.id) call.id = part.id;
        if (part.type) call.type = part.type;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls[index] = call;
      }
    } else if (delta?.function_call) {
      const call = calls[0] || { function: { name: '', arguments: '' } };
      if (delta.function_call.name) call.function.name += delta.function_call.name;
      if (delta.function_call.arguments) call.function.arguments += delta.function_call.arguments;
      calls[0] = call;
    }
  }
  const completedCalls = calls.filter(Boolean);
  return {
    text,
    reasoning: reasoning || undefined,
    messages: responseMessages(text, reasoning, completedCalls),
    model,
    inputTokens,
    outputTokens,
  };
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
        if (item.type === 'message' || typeof item.role === 'string') {
          const role = ['user', 'assistant', 'system', 'developer', 'tool'].includes(item.role)
            ? item.role
            : 'user';
          let content = '';
          if (Array.isArray(item.content)) {
            const parts = item.content
              .map((p: any) => {
                if (p?.type === 'input_text' || p?.type === 'text') return p.text;
                if (p?.type === 'input_image') return `[图片] ${p.image_url || ''}`;
                if (p?.type === 'output_text') return p.text;
                return asString(p);
              })
              .filter(Boolean);
            content = parts.join('\n');
          } else if (typeof item.content === 'string') {
            content = item.content;
          }
          if (content || item.type === 'message') out.push({ role, content });
        } else if (item.type === 'reasoning' && Array.isArray(item.summary)) {
          const reasoning = item.summary
            .filter((part: any) => part?.type === 'summary_text' && typeof part.text === 'string')
            .map((part: any) => part.text)
            .join('\n\n');
          if (reasoning) out.push({ role: 'assistant', content: '', meta: { reasoning } });
        } else if (item.type === 'function_call') {
          out.push(toolCallMessage(item));
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

export function parseResponsesNonStream(respJson: any): ParsedResponse {
  if (!respJson || typeof respJson !== 'object') return { text: '' };
  let text = '';
  let reasoning = '';
  let hasTools = false;
  const messages: ParsedMessage[] = [];
  const outs = respJson.output || [];
  for (const o of outs) {
    if (o.type === 'message' && Array.isArray(o.content)) {
      let messageText = '';
      for (const c of o.content) if (c.type === 'output_text') messageText += c.text || '';
      text += messageText;
      if (messageText) messages.push({ role: 'assistant', content: messageText });
    } else if (o.type === 'reasoning' && Array.isArray(o.summary)) {
      const summaryText = o.summary
        .filter((summary: any) => summary?.type === 'summary_text' && typeof summary.text === 'string')
        .map((summary: any) => summary.text)
        .join('\n\n');
      reasoning += summaryText;
      if (summaryText) messages.push({ role: 'assistant', content: '', meta: { reasoning: summaryText } });
    } else if (o.type === 'function_call') {
      hasTools = true;
      messages.push(toolCallMessage(o));
    } else if (o.type === 'function_call_output') {
      hasTools = true;
      messages.push({
        role: 'tool',
        content: `[tool_result] ${asString(o.output)}`,
        meta: { call_id: o.call_id },
      });
    }
  }
  return {
    text,
    reasoning: reasoning || undefined,
    messages: hasTools || messages.length > 1 ? messages : undefined,
    model: respJson.model,
    inputTokens: respJson.usage?.input_tokens,
    outputTokens: respJson.usage?.output_tokens,
  };
}

export function parseResponsesStream(events: { data: string }[]): ParsedResponse {
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const outputItems = new Map<number, any>();
  const itemIndexes = new Map<string, number>();
  const ensureItem = (index: number, type: string) => {
    const item = outputItems.get(index) || { type, text: '', reasoning: '', arguments: '' };
    if (!item.type) item.type = type;
    outputItems.set(index, item);
    return item;
  };
  const itemIndex = (event: any) => {
    if (typeof event.output_index === 'number') return event.output_index;
    if (event.item_id && itemIndexes.has(event.item_id)) return itemIndexes.get(event.item_id)!;
    return outputItems.size;
  };
  const applyOutputItem = (index: number, source: any) => {
    const item = ensureItem(index, source?.type || 'message');
    if (source?.id) {
      item.id = source.id;
      itemIndexes.set(source.id, index);
    }
    if (source?.call_id) item.call_id = source.call_id;
    if (source?.name) item.name = source.name;
    if (typeof source?.arguments === 'string') item.arguments = source.arguments;
    if (source?.type === 'message' && !item.text && Array.isArray(source.content)) {
      item.text = source.content
        .filter((part: any) => part?.type === 'output_text')
        .map((part: any) => part.text || '')
        .join('');
    }
    if (source?.type === 'reasoning' && !item.reasoning && Array.isArray(source.summary)) {
      item.reasoning = source.summary
        .filter((part: any) => part?.type === 'summary_text')
        .map((part: any) => part.text || '')
        .join('\n\n');
    }
    if (source?.type === 'function_call_output') item.output = source.output;
    return item;
  };
  for (const e of events) {
    const j = safeParse(e.data);
    if (!j) continue;
    if (j.model) model = j.model;
    if (j.response?.model) model = j.response.model;
    if (j.type === 'response.completed' && Array.isArray(j.response?.output)) {
      j.response.output.forEach((item: any, index: number) => applyOutputItem(index, item));
    }
    if ((j.type === 'response.output_item.added' || j.type === 'response.output_item.done') && j.item) {
      applyOutputItem(itemIndex(j), j.item);
    } else if (j.type === 'response.output_text.delta') {
      ensureItem(itemIndex(j), 'message').text += j.delta || '';
    } else if (j.type === 'response.reasoning_summary_text.delta') {
      ensureItem(itemIndex(j), 'reasoning').reasoning += j.delta || '';
    } else if (j.type === 'response.function_call_arguments.delta') {
      ensureItem(itemIndex(j), 'function_call').arguments += j.delta || '';
    } else if (j.type === 'response.function_call_arguments.done') {
      const item = ensureItem(itemIndex(j), 'function_call');
      if (typeof j.arguments === 'string') item.arguments = j.arguments;
    }
    const usage = j.usage || j.response?.usage;
    if (usage) {
      inputTokens = usage.input_tokens ?? inputTokens;
      outputTokens = usage.output_tokens ?? outputTokens;
    }
  }
  let text = '';
  let reasoning = '';
  let hasTools = false;
  const messages: ParsedMessage[] = [];
  const orderedItems = Array.from(outputItems.entries()).sort(([a], [b]) => a - b);
  for (const [, item] of orderedItems) {
    if (item.type === 'message') {
      text += item.text || '';
      if (item.text) messages.push({ role: 'assistant', content: item.text });
    } else if (item.type === 'reasoning') {
      reasoning += item.reasoning || '';
      if (item.reasoning) messages.push({ role: 'assistant', content: '', meta: { reasoning: item.reasoning } });
    } else if (item.type === 'function_call') {
      hasTools = true;
      messages.push(toolCallMessage(item));
    } else if (item.type === 'function_call_output') {
      hasTools = true;
      messages.push({
        role: 'tool',
        content: `[tool_result] ${asString(item.output)}`,
        meta: { call_id: item.call_id },
      });
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
