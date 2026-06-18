/**
 * 协议解析器主入口
 * 把抓到的原始请求/响应/SSE 流解析为对话消息。
 */
import type { Protocol, ParsedMessage, ParsedConversation } from './types';
import { splitSSE, safeParse, asString } from './sse';
import * as openai from './openai';
import * as anthropic from './anthropic';
import * as gemini from './gemini';

export { splitSSE, safeParse, asString };
export * from './types';
export { openai, anthropic, gemini };

export function detectProtocol(
  url: string,
  reqBody: string | null,
  respCT: string | null,
): Protocol {
  const u = url.toLowerCase();
  if (u.includes('/v1/messages') || u.includes('/anthropic')) return 'anthropic.messages';
  if (u.includes('/v1/responses')) return 'openai.responses';
  if (u.includes('/v1/chat/completions')) return 'openai.chat';
  if (
    u.includes(':streamgeneratecontent') ||
    u.includes(':generatecontent') ||
    u.includes('/v1beta/models/')
  )
    return 'gemini.generateContent';

  // 兜底看 body 形状
  const j = safeParse(reqBody);
  if (j && typeof j === 'object') {
    if (Array.isArray(j.messages) && (j.model || j.stream !== undefined)) return 'openai.chat';
    if (Array.isArray(j.input) && j.model) return 'openai.responses';
    if (Array.isArray(j.contents) && j.contents[0]?.parts) return 'gemini.generateContent';
  }
  return 'unknown';
}

function extractInputMessages(protocol: Protocol, reqJson: any): ParsedMessage[] {
  if (!reqJson) return [];
  switch (protocol) {
    case 'openai.chat':
      return openai.extractChatInput(reqJson);
    case 'openai.responses':
      return openai.extractResponsesInput(reqJson);
    case 'anthropic.messages':
      return anthropic.extractInput(reqJson);
    case 'gemini.generateContent':
      return gemini.extractInput(reqJson);
    default:
      return [];
  }
}

function parseResponse(
  protocol: Protocol,
  respBody: string,
  respCT: string | null,
): { text: string; model?: string; inputTokens?: number; outputTokens?: number } {
  const isStream =
    (respCT || '').toLowerCase().includes('text/event-stream') ||
    respBody.includes('data: ') ||
    respBody.startsWith('event:');

  if (isStream) {
    const events = splitSSE(respBody);
    let parsed: { text: string; model?: string; inputTokens?: number; outputTokens?: number };
    switch (protocol) {
      case 'openai.chat':
        parsed = openai.parseChatStream(events);
        break;
      case 'openai.responses':
        parsed = openai.parseResponsesStream(events);
        break;
      case 'anthropic.messages':
        parsed = anthropic.parseStream(events);
        break;
      case 'gemini.generateContent':
        parsed = gemini.parseStream(events);
        break;
      default:
        parsed = { text: events.map((e) => e.data).join('\n') };
    }
    if (!parsed.text) {
      const j = safeParse(respBody);
      if (j) {
        const fallback = parseResponseNonStream(protocol, j);
        return fallback;
      }
    }
    return parsed;
  }

  const j = safeParse(respBody);
  return parseResponseNonStream(protocol, j);
}

function parseResponseNonStream(
  protocol: Protocol,
  respJson: any,
): { text: string; model?: string; inputTokens?: number; outputTokens?: number } {
  switch (protocol) {
    case 'openai.chat':
      return openai.parseChatNonStream(respJson);
    case 'openai.responses':
      return openai.parseResponsesNonStream(respJson);
    case 'anthropic.messages':
      return anthropic.parseNonStream(respJson);
    case 'gemini.generateContent':
      return gemini.parseNonStream(respJson);
    default:
      return { text: asString(respJson) };
  }
}

/**
 * 入口：解析一对 (req, resp) 为会话。
 */
export function parseConversation(
  url: string,
  reqBody: string | null,
  respBody: string | null,
  respCT: string | null,
): ParsedConversation {
  const protocol = detectProtocol(url, reqBody, respCT);
  const reqJson = safeParse(reqBody);
  const inputMessages = extractInputMessages(protocol, reqJson);

  if (!respBody) {
    return { protocol, messages: inputMessages };
  }

  const parsed = parseResponse(protocol, respBody, respCT);
  const messages: ParsedMessage[] = [...inputMessages];
  if (parsed.text) messages.push({ role: 'assistant', content: parsed.text });

  return {
    protocol,
    model: parsed.model ?? reqJson?.model,
    messages,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
  };
}

/**
 * 摘要预览：取最后一条 assistant 或 user 消息的前 60 字符
 */
export function makePreview(parsed: ParsedConversation): string {
  const last = [...parsed.messages]
    .reverse()
    .find((m) => m.role === 'assistant' || m.role === 'user');
  if (!last) return '(空)';
  const t = last.content.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}