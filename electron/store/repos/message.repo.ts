import type { JsonStore } from '../jsonStore';
import type { MessageRow, MessageRole } from '../types';

export interface InsertMessageInput {
  conversation_id: number;
  role: MessageRole;
  content: string;
  ts: number;
  seq: number;
  meta?: string | null;
}

export class MessageRepo {
  constructor(private store: JsonStore) {}

  insert(input: InsertMessageInput): number {
    const data = this.store.getData();
    const row: MessageRow = {
      id: this.store.nextId('message'),
      ...input,
      meta: input.meta ?? null,
    };
    data.messages.push(row);
    this.store.scheduleFlush();
    return row.id;
  }

  listByConversation(conversationId: number): MessageRow[] {
    return this.store
      .getData()
      .messages.filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => a.seq - b.seq || a.id - b.id);
  }
}