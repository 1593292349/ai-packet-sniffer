export type Protocol =
  | 'openai.chat'
  | 'openai.responses'
  | 'anthropic.messages'
  | 'gemini.generateContent'
  | 'unknown';

export interface ParsedMessage {
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool';
  content: string;
  meta?: Record<string, any>;
}

export interface ParsedResponse {
  text: string;
  reasoning?: string;
  messages?: ParsedMessage[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ParsedConversation {
  protocol: Protocol;
  model?: string;
  messages: ParsedMessage[];
  inputTokens?: number;
  outputTokens?: number;
}