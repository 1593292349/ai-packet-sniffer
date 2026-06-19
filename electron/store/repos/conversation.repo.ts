import { syncAddressHitCounts, type JsonStore } from '../jsonStore';
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

export interface DeleteConversationsResult {
  deleted: boolean;
  rawIds: number[];
}

export interface ClearConversationsResult {
  deletedCount: number;
  rawIds: number[];
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

  delete(id: number): DeleteConversationsResult {
    const data = this.store.getData();
    const conversation = data.conversations.find((row) => row.id === id);
    if (!conversation) return { deleted: false, rawIds: [] };

    const rawCandidates = new Set<number>();
    if (conversation.raw_request_id != null) rawCandidates.add(conversation.raw_request_id);
    if (conversation.raw_response_id != null) rawCandidates.add(conversation.raw_response_id);
    data.conversations = data.conversations.filter((row) => row.id !== id);
    data.messages = data.messages.filter((row) => row.conversation_id !== id);

    const retainedRawIds = new Set<number>();
    for (const row of data.conversations) {
      if (row.raw_request_id != null) retainedRawIds.add(row.raw_request_id);
      if (row.raw_response_id != null) retainedRawIds.add(row.raw_response_id);
    }
    const rawIds = Array.from(rawCandidates).filter((rawId) => !retainedRawIds.has(rawId));
    if (rawIds.length > 0) {
      const removedRawIds = new Set(rawIds);
      data.raw_requests = data.raw_requests.filter((row) => !removedRawIds.has(row.id));
    }
    syncAddressHitCounts(data, conversation.address_id);
    this.store.scheduleFlush();
    return { deleted: true, rawIds };
  }

  clearByAddress(addressId: number): ClearConversationsResult {
    const data = this.store.getData();
    const deletedConversations = data.conversations.filter((row) => row.address_id === addressId);
    const deletedConversationIds = new Set(deletedConversations.map((row) => row.id));
    const rawCandidates = new Set(
      data.raw_requests.filter((row) => row.address_id === addressId).map((row) => row.id),
    );
    for (const row of deletedConversations) {
      if (row.raw_request_id != null) rawCandidates.add(row.raw_request_id);
      if (row.raw_response_id != null) rawCandidates.add(row.raw_response_id);
    }
    if (deletedConversationIds.size === 0 && rawCandidates.size === 0) {
      if (syncAddressHitCounts(data, addressId)) this.store.scheduleFlush();
      return { deletedCount: 0, rawIds: [] };
    }

    data.conversations = data.conversations.filter((row) => !deletedConversationIds.has(row.id));
    data.messages = data.messages.filter((row) => !deletedConversationIds.has(row.conversation_id));
    const retainedRawIds = new Set<number>();
    for (const row of data.conversations) {
      if (row.raw_request_id != null) retainedRawIds.add(row.raw_request_id);
      if (row.raw_response_id != null) retainedRawIds.add(row.raw_response_id);
    }
    const rawIds = Array.from(rawCandidates).filter((rawId) => !retainedRawIds.has(rawId));
    if (rawIds.length > 0) {
      const removedRawIds = new Set(rawIds);
      data.raw_requests = data.raw_requests.filter((row) => !removedRawIds.has(row.id));
    }
    syncAddressHitCounts(data, addressId);
    this.store.scheduleFlush();
    return { deletedCount: deletedConversationIds.size, rawIds };
  }
}
