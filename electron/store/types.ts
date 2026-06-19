/**
 * 存储层公共类型定义
 */

export interface AddressRow {
  id: number;
  pattern: string;
  label: string | null;
  enabled: number;
  created_at: number;
  last_hit_at: number | null;
  hit_count: number;
}

export interface ConversationRow {
  id: number;
  address_id: number;
  url: string;
  method: string;
  started_at: number;
  ended_at: number | null;
  status: number | null;
  model: string | null;
  raw_request_id: number | null;
  raw_response_id: number | null;
  message_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  preview: string | null;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'developer' | 'tool';

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  ts: number;
  seq: number;
  meta: string | null;
}

export interface RawRequestRow {
  id: number;
  address_id: number;
  method: string;
  url: string;
  req_headers: string;
  req_body: string;
  resp_status: number | null;
  resp_headers: string | null;
  resp_body: string | null;
  started_at: number;
  ended_at: number | null;
  protocol: string | null;
  client_addr: string | null;
}

export interface StoreData {
  addresses: AddressRow[];
  conversations: ConversationRow[];
  messages: MessageRow[];
  raw_requests: RawRequestRow[];
  _nextIds: {
    address: number;
    conversation: number;
    message: number;
    raw: number;
  };
}