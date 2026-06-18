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

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  ts: number;
  seq: number;
  meta: string | null;
}