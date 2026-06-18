/**
 * 抓包回调业务逻辑
 * 把原始 (ctx) → 解析 → 入库 → 通知前端 串起来
 */
import type { BrowserWindow } from 'electron';
import type { CaptureContext } from './proxy';
import type { Store } from './store';
import { findMatchingAddress } from './matcher';
import { parseConversation, makePreview } from './parser';
import type { Logger } from './logger';

export class CaptureService {
  constructor(
    private store: Store,
    private getWindow: () => BrowserWindow | null,
    private logger: Logger,
  ) {}

  handle(ctx: CaptureContext): void {
    try {
      const addrs = this.store.addresses.list();
      const match = findMatchingAddress(addrs, ctx.url);
      if (!match) return;
      this.store.addresses.recordHit(match.id);

      const parsed = parseConversation(
        ctx.url,
        ctx.reqBody || null,
        ctx.respBody || null,
        ctx.respCT,
      );

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

      let seq = 0;
      for (const m of parsed.messages) {
        this.store.messages.insert({
          conversation_id: convId,
          role: m.role,
          content: m.content,
          ts: ctx.startedAt,
          seq: seq++,
          meta: m.meta ? JSON.stringify(m.meta) : null,
        });
      }

      this.logger.debug('captured', {
        address: match.pattern,
        protocol: parsed.protocol,
        msgs: parsed.messages.length,
      });

      const win = this.getWindow();
      if (win) {
        win.webContents.send('capture:new', {
          addressId: match.id,
          conversationId: convId,
        });
      }
    } catch (e) {
      this.logger.error('capture handler error', { error: String(e) });
    }
  }
}