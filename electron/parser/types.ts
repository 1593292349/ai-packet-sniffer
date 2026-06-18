export type Protocol =
  | 'openai.chat'
  | 'openai.responses'
  | 'anthropic.messages'
  | 'gemini.generateContent'
  | 'unknown';

export interface ParsedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  meta?: Record<string, any>;
}

export interface ParsedConversation {
  protocol: Protocol;
  model?: string;
  messages: ParsedMessage[];
  inputTokens?: number;
  outputTokens?: number;
}