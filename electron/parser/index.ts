/**
 * 协议解析器主入口
 * 把抓到的原始请求/响应/SSE 流解析为对话消息。
 */
import type { Protocol, ParsedMessage, ParsedConversation, ParsedResponse } from './types';
import { splitSSE, safeParse, asString } from './sse';
import * as openai from './openai';
import * as anthropic from './anthropic';
import * as gemini from './gemini';

export { splitSSE, safeParse, asString };
export * from './types';
export { openai, anthropic, gemini };

function normalizedPathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.toLowerCase().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function detectProtocolFromUrl(rawUrl: string): Protocol {
  const pathname = normalizedPathname(rawUrl);
  if (pathname.endsWith('/v1/messages')) return 'anthropic.messages';
  if (pathname.endsWith('/v1/responses')) return 'openai.responses';
  if (pathname.endsWith('/chat/completions')) return 'openai.chat';
  if (/\/v1(?:beta)?\/models\/[^/]+:(?:stream)?generatecontent$/.test(pathname)) {
    return 'gemini.generateContent';
  }
  return 'unknown';
}

function isKnownNonConversationPath(pathname: string): boolean {
  return (
    pathname.endsWith('/models') ||
    pathname.endsWith('/props') ||
    pathname.endsWith('/messages/count_tokens') ||
    pathname.endsWith('/responses/compact') ||
    pathname.endsWith('/responses/input_tokens') ||
    pathname.endsWith('/embeddings') ||
    pathname.endsWith('/moderations') ||
    pathname.endsWith('/audio/speech') ||
    pathname.endsWith(':counttokens')
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasConversationMessages(reqJson: unknown): boolean {
  if (!isObject(reqJson) || !Array.isArray(reqJson.messages) || reqJson.messages.length === 0) {
    return false;
  }
  return reqJson.messages.every((message) => {
    if (!isObject(message) || typeof message.role !== 'string' || !message.role.trim()) return false;
    const content = message.content;
    const hasContent =
      (typeof content === 'string' && content.length > 0) ||
      (Array.isArray(content) && content.length > 0) ||
      isObject(content);
    const hasToolCall =
      (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
      isObject(message.function_call);
    return hasContent || hasToolCall;
  });
}

function hasResponsesInput(reqJson: unknown): boolean {
  if (!isObject(reqJson)) return false;
  if (typeof reqJson.input === 'string') return reqJson.input.length > 0;
  if (Array.isArray(reqJson.input)) {
    return (
      reqJson.input.length > 0 &&
      reqJson.input.every(
        (item) =>
          (typeof item === 'string' && item.length > 0) ||
          (isObject(item) && Object.keys(item).length > 0),
      )
    );
  }
  return (
    (typeof reqJson.previous_response_id === 'string' && reqJson.previous_response_id.length > 0) ||
    (typeof reqJson.instructions === 'string' && reqJson.instructions.length > 0) ||
    (typeof reqJson.conversation === 'string' && reqJson.conversation.length > 0) ||
    (isObject(reqJson.conversation) && Object.keys(reqJson.conversation).length > 0) ||
    (isObject(reqJson.prompt) && Object.keys(reqJson.prompt).length > 0)
  );
}

function hasGeminiContents(reqJson: unknown): boolean {
  if (!isObject(reqJson) || !Array.isArray(reqJson.contents) || reqJson.contents.length === 0) {
    return false;
  }
  return reqJson.contents.every(
    (content) =>
      isObject(content) &&
      Array.isArray(content.parts) &&
      content.parts.length > 0 &&
      content.parts.every((part) => isObject(part) && Object.keys(part).length > 0),
  );
}

function hasHeader(reqHeaders: Record<string, unknown> | null | undefined, name: string): boolean {
  return Boolean(
    reqHeaders && Object.keys(reqHeaders).some((headerName) => headerName.toLowerCase() === name),
  );
}

function matchesProtocolBody(protocol: Protocol, reqJson: unknown): boolean {
  switch (protocol) {
    case 'openai.chat':
    case 'anthropic.messages':
      return hasConversationMessages(reqJson);
    case 'openai.responses':
      return hasResponsesInput(reqJson);
    case 'gemini.generateContent':
      return hasGeminiContents(reqJson);
    default:
      return false;
  }
}

function detectProtocolFromBody(
  reqJson: unknown,
  reqHeaders?: Record<string, unknown> | null,
): Protocol {
  if (hasConversationMessages(reqJson)) {
    return hasHeader(reqHeaders, 'anthropic-version') ? 'anthropic.messages' : 'openai.chat';
  }
  if (hasResponsesInput(reqJson)) return 'openai.responses';
  if (hasGeminiContents(reqJson)) return 'gemini.generateContent';
  return 'unknown';
}

function detectProtocolFromRequest(
  url: string,
  reqJson: unknown,
  reqHeaders?: Record<string, unknown> | null,
): Protocol {
  const urlProtocol = detectProtocolFromUrl(url);
  return urlProtocol !== 'unknown' ? urlProtocol : detectProtocolFromBody(reqJson, reqHeaders);
}

function detectConversationProtocol(
  url: string,
  reqJson: unknown,
  respBody: string | null,
  respCT: string | null,
  reqHeaders?: Record<string, unknown> | null,
): Protocol {
  const urlProtocol = detectProtocolFromUrl(url);
  if (urlProtocol !== 'unknown') {
    return matchesProtocolBody(urlProtocol, reqJson) ? urlProtocol : 'unknown';
  }

  if (hasConversationMessages(reqJson)) {
    return hasHeader(reqHeaders, 'anthropic-version') ? 'anthropic.messages' : 'openai.chat';
  }
  if (hasGeminiContents(reqJson)) return 'gemini.generateContent';
  if (hasResponsesInput(reqJson)) {
    return hasResponsesRequestSignal(reqJson) || hasResponsesResponse(respBody, respCT)
      ? 'openai.responses'
      : 'unknown';
  }
  return 'unknown';
}

function hasResponsesRequestSignal(reqJson: unknown): boolean {
  if (!isObject(reqJson)) return false;
  if (
    typeof reqJson.previous_response_id === 'string' ||
    typeof reqJson.instructions === 'string' ||
    typeof reqJson.conversation === 'string' ||
    isObject(reqJson.conversation) ||
    isObject(reqJson.prompt) ||
    Array.isArray(reqJson.tools) ||
    isObject(reqJson.reasoning) ||
    isObject(reqJson.text) ||
    typeof reqJson.max_output_tokens === 'number'
  ) {
    return true;
  }
  return (
    Array.isArray(reqJson.input) &&
    reqJson.input.some(
      (item) =>
        isObject(item) &&
        (typeof item.role === 'string' || typeof item.type === 'string'),
    )
  );
}

function hasResponsesResponse(respBody: string | null, respCT: string | null): boolean {
  if (!respBody) return false;
  const contentType = (respCT || '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return splitSSE(respBody).some((event) => {
      if (event.event?.toLowerCase().startsWith('response.')) return true;
      const data = safeParse(event.data);
      return isObject(data) && typeof data.type === 'string' && data.type.startsWith('response.');
    });
  }
  if (contentType && !contentType.includes('json')) return false;
  const respJson = safeParse(respBody);
  return (
    isObject(respJson) &&
    (respJson.object === 'response' || Array.isArray(respJson.output))
  );
}

export function detectProtocol(
  url: string,
  reqBody: string | null,
  _respCT: string | null,
): Protocol {
  return detectProtocolFromRequest(url, safeParse(reqBody));
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
): ParsedResponse {
  const isStream =
    (respCT || '').toLowerCase().includes('text/event-stream') ||
    respBody.includes('data: ') ||
    respBody.startsWith('event:');

  if (isStream) {
    const events = splitSSE(respBody);
    let parsed: ParsedResponse;
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
    if (!parsed.text && !parsed.reasoning && !parsed.messages?.length) {
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
): ParsedResponse {
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
function parseConversationData(
  protocol: Protocol,
  reqJson: any,
  respBody: string | null,
  respCT: string | null,
): ParsedConversation {
  const inputMessages = extractInputMessages(protocol, reqJson);

  if (!respBody) {
    return { protocol, messages: inputMessages };
  }

  const parsed = parseResponse(protocol, respBody, respCT);
  const messages: ParsedMessage[] = [...inputMessages];
  if (parsed.messages?.length) {
    messages.push(...parsed.messages);
  } else if (parsed.text || parsed.reasoning) {
    messages.push({
      role: 'assistant',
      content: parsed.text,
      meta: parsed.reasoning ? { reasoning: parsed.reasoning } : undefined,
    });
  }

  return {
    protocol,
    model: parsed.model ?? reqJson?.model,
    messages,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
  };
}

export function parseConversation(
  url: string,
  reqBody: string | null,
  respBody: string | null,
  respCT: string | null,
): ParsedConversation {
  const reqJson = safeParse(reqBody);
  return parseConversationData(
    detectProtocolFromRequest(url, reqJson),
    reqJson,
    respBody,
    respCT,
  );
}

export function parseCapturedConversation(
  url: string,
  method: string,
  reqBody: string | null,
  respBody: string | null,
  respCT: string | null,
  reqHeaders?: Record<string, unknown> | null,
): ParsedConversation | null {
  if (method.toUpperCase() !== 'POST') return null;
  if (isKnownNonConversationPath(normalizedPathname(url))) return null;

  const reqJson = safeParse(reqBody);
  const protocol = detectConversationProtocol(url, reqJson, respBody, respCT, reqHeaders);
  if (protocol === 'unknown') return null;
  return parseConversationData(protocol, reqJson, respBody, respCT);
}

/**
 * 摘要预览：取最后一条 assistant 或 user 消息的前 60 字符
 */
export function makePreview(parsed: ParsedConversation): string {
  const last = [...parsed.messages]
    .reverse()
    .find((m) => (m.role === 'assistant' || m.role === 'user') && m.content.trim());
  if (!last) return '(空)';
  const t = last.content.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}