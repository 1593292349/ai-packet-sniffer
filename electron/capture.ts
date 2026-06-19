/**
 * 抓包回调业务逻辑
 *
 * 一个 HTTP AI 请求对应一个 conversation。
 * 不再把同地址的连续请求合并，否则 raw_request_id、messages、system/developer
 * 会跨请求混在一起，导致原始数据和消息列表不一致。
 */
import type { BrowserWindow } from 'electron';
import type { CaptureContext } from './proxy';
import type { Store } from './store';
import { findMatchingAddress } from './matcher';
import { parseCapturedConversation, makePreview } from './parser';
import type { Logger } from './logger';

function parseHeaders(rawHeaders: string | null): Record<string, unknown> | null {
  if (!rawHeaders) return null;
  try {
    const parsed = JSON.parse(rawHeaders);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function responseContentType(rawHeaders: string | null): string | null {
  const headers = parseHeaders(rawHeaders);
  if (!headers) return null;
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type');
  if (!entry) return null;
  const value = entry[1];
  return Array.isArray(value) ? value.map(String).join('; ') : String(value);
}

export class CaptureService {
  constructor(
    private store: Store,
    private getWindow: () => BrowserWindow | null,
    private logger: Logger,
  ) {}

  repairMissingUserMessages(): number {
    const data = this.store.json.getData();
    const conversationsWithUser = new Set<number>();
    for (const message of data.messages) {
      if (message.role === 'user') conversationsWithUser.add(message.conversation_id);
    }

    const rawsById = new Map(data.raw_requests.map((raw) => [raw.id, raw]));
    const repaired = new Map<number, NonNullable<ReturnType<typeof parseCapturedConversation>>>();
    for (const conversation of data.conversations) {
      if (conversationsWithUser.has(conversation.id) || conversation.raw_request_id == null) continue;
      const raw = rawsById.get(conversation.raw_request_id);
      if (!raw) continue;
      const parsed = parseCapturedConversation(
        raw.url,
        raw.method,
        raw.req_body,
        raw.resp_body,
        responseContentType(raw.resp_headers),
        parseHeaders(raw.req_headers),
      );
      if (!parsed?.messages.some((message) => message.role === 'user')) continue;
      repaired.set(conversation.id, parsed);
      conversation.model = parsed.model ?? conversation.model;
      conversation.message_count = parsed.messages.length;
      conversation.input_tokens = parsed.inputTokens ?? conversation.input_tokens;
      conversation.output_tokens = parsed.outputTokens ?? conversation.output_tokens;
      conversation.preview = makePreview(parsed);
    }

    if (repaired.size === 0) return 0;
    data.messages = data.messages.filter((message) => !repaired.has(message.conversation_id));
    for (const conversation of data.conversations) {
      const parsed = repaired.get(conversation.id);
      if (!parsed) continue;
      parsed.messages.forEach((message, seq) => {
        data.messages.push({
          id: this.store.json.nextId('message'),
          conversation_id: conversation.id,
          role: message.role,
          content: message.content,
          ts: conversation.started_at,
          seq,
          meta: message.meta ? JSON.stringify(message.meta) : null,
        });
      });
    }
    this.store.json.scheduleFlush();
    return repaired.size;
  }

  handle(ctx: CaptureContext): void {
    try {
      const addrs = this.store.addresses.list();
      const match = findMatchingAddress(addrs, ctx.url);
      if (!match) return;
      const parsed = parseCapturedConversation(
        ctx.url,
        ctx.method,
        ctx.reqBody || null,
        ctx.respBody || null,
        ctx.respCT,
        ctx.reqHeaders,
      );
      if (!parsed) return;
      this.store.addresses.recordHit(match.id);

      const rawId = this.store.raws.insert({
        address_id: match.id,
        method: ctx.method,
        url: ctx.url,
        req_headers: JSON.stringify(ctx.reqHeaders),
        req_body: ctx.reqBody || '',
        resp_status: ctx.respStatus,
        resp_headers: ctx.respHeaders ? JSON.stringify(ctx.respHeaders) : null,
        resp_body: ctx.respBody || null,
        started_at: ctx.startedAt,
        ended_at: ctx.endedAt,
        protocol: parsed.protocol,
        client_addr: ctx.clientAddr,
      });

      const convId = this.store.conversations.insert({
        address_id: match.id,
        url: ctx.url,
        method: ctx.method,
        started_at: ctx.startedAt,
        ended_at: ctx.endedAt,
        status: ctx.respStatus,
        model: parsed.model ?? null,
        raw_request_id: rawId,
        message_count: parsed.messages.length,
        input_tokens: parsed.inputTokens ?? null,
        output_tokens: parsed.outputTokens ?? null,
        preview: makePreview(parsed),
      });

      parsed.messages.forEach((m, seq) => {
        this.store.messages.insert({
          conversation_id: convId,
          role: m.role,
          content: m.content,
          ts: ctx.startedAt,
          seq,
          meta: m.meta ? JSON.stringify(m.meta) : null,
        });
      });

      this.logger.debug('new conversation', { convId, msgs: parsed.messages.length });

      const win = this.getWindow();
      if (win) {
        win.webContents.send('capture:new', {
          addressId: match.id,
          conversationId: convId,
          isNew: true,
        });
      }
    } catch (e) {
      this.logger.error('capture handler error', { error: String(e) });
    }
  }
}
