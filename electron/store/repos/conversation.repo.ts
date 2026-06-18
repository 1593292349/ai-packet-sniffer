import type { JsonStore } from '../jsonStore';
import type { ConversationRow } from '../types';

export interface InsertConversationInput {
  address_id: number;
  url: string;
  method: string;
  started_at: number;
  ended_at: number | null;
  status: number | null;
  model: string | null;
  raw_request_id: number | null;
  raw_response_id?: number | null;
  message_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  preview: string | null;
}

export class ConversationRepo {
  constructor(private store: JsonStore) {}

  insert(input: InsertConversationInput): number {
    const data = this.store.getData();
    const row: ConversationRow = {
      id: this.store.nextId('conversation'),
      ...input,
      raw_response_id: input.raw_response_id ?? null,
    };
    data.conversations.push(row);
    this.store.scheduleFlush();
    return row.id;
  }

  listByAddress(addressId: number, limit = 500): ConversationRow[] {
    return this.store
      .getData()
      .conversations.filter((c) => c.address_id === addressId)
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, limit);
  }

  getById(id: number): ConversationRow | undefined {
    return this.store.getData().conversations.find((c) => c.id === id);
  }
}