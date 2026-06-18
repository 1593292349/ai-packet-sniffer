/**
 * Parser 单元测试
 * 覆盖：OpenAI Chat / OpenAI Responses / Anthropic Messages / Gemini / SSE / URL 匹配
 */
import { describe, it, expect } from 'vitest';
import {
  parseConversation,
  detectProtocol,
  makePreview,
  splitSSE,
  safeParse,
  asString,
} from '../electron/parser';
import { matchesPattern } from '../electron/matcher';

describe('splitSSE', () => {
  it('拆单事件', () => {
    const body = 'event: foo\ndata: {"a":1}\n\n';
    expect(splitSSE(body)).toEqual([{ event: 'foo', data: '{"a":1}' }]);
  });

  it('拆多事件', () => {
    const body = 'data: 1\n\ndata: 2\n\n';
    expect(splitSSE(body)).toEqual([
      { event: undefined, data: '1' },
      { event: undefined, data: '2' },
    ]);
  });

  it('多行 data 用 \\n 拼接', () => {
    const body = 'data: line1\ndata: line2\n\n';
    expect(splitSSE(body)).toEqual([{ event: undefined, data: 'line1\nline2' }]);
  });

  it('忽略注释行（: 开头）', () => {
    const body = ':heartbeat\ndata: ok\n\n';
    expect(splitSSE(body)).toEqual([{ event: undefined, data: 'ok' }]);
  });

  it('忽略空尾部', () => {
    expect(splitSSE('data: only\n\n\n\n')).toEqual([{ event: undefined, data: 'only' }]);
  });
});

describe('safeParse / asString', () => {
  it('safeParse 解析合法 JSON', () => {
    expect(safeParse('{"x":1}')).toEqual({ x: 1 });
  });
  it('safeParse 失败返回 null', () => {
    expect(safeParse('xxx')).toBe(null);
    expect(safeParse(null)).toBe(null);
  });
  it('asString 字符串原样返回', () => {
    expect(asString('hi')).toBe('hi');
  });
  it('asString 对象 stringify', () => {
    expect(asString({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  it('asString null 返回空串', () => {
    expect(asString(null)).toBe('');
  });
});

describe('detectProtocol', () => {
  it.each([
    ['https://api.openai.com/v1/chat/completions', 'openai.chat'],
    ['https://api.openai.com/v1/responses', 'openai.responses'],
    ['https://api.anthropic.com/v1/messages', 'anthropic.messages'],
    ['https://api.minimaxi.com/anthropic/v1/messages', 'anthropic.messages'],
    [
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent',
      'gemini.generateContent',
    ],
  ])('URL %s → %s', (url, expected) => {
    expect(detectProtocol(url, null, null)).toBe(expected);
  });
});

describe('parseConversation - OpenAI Chat 流式', () => {
  it('解析 system + user + assistant（流式 token 拼接）', () => {
    const req = JSON.stringify({
      model: 'gpt-4o-mini',
      stream: true,
      messages: [
        { role: 'system', content: '你是一个助手' },
        { role: 'user', content: '你好' },
      ],
    });
    const sse = [
      'data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"你"}}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{"content":"，"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{"content":"世界"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: {"usage":{"prompt_tokens":15,"completion_tokens":6,"total_tokens":21}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const parsed = parseConversation(
      'https://api.openai.com/v1/chat/completions',
      req,
      sse,
      'text/event-stream',
    );
    expect(parsed.protocol).toBe('openai.chat');
    expect(parsed.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(parsed.messages[0].content).toBe('你是一个助手');
    expect(parsed.messages[1].content).toBe('你好');
    expect(parsed.messages[2].content).toBe('你好，世界');
    expect(parsed.model).toBe('gpt-4o-mini');
    expect(parsed.inputTokens).toBe(15);
    expect(parsed.outputTokens).toBe(6);
  });
});

describe('parseConversation - OpenAI Responses 非流式', () => {
  it('解析 instructions + string input + output_text', () => {
    const req = JSON.stringify({
      model: 'gpt-4o',
      instructions: '简短回答',
      input: '你是谁',
    });
    const resp = JSON.stringify({
      status: 'completed',
      model: 'gpt-4o',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '我是AI' }],
        },
      ],
      usage: { input_tokens: 8, output_tokens: 5 },
    });
    const parsed = parseConversation(
      'https://api.openai.com/v1/responses',
      req,
      resp,
      'application/json',
    );
    expect(parsed.protocol).toBe('openai.responses');
    expect(parsed.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(parsed.messages[0].content).toBe('简短回答');
    expect(parsed.messages[1].content).toBe('你是谁');
    expect(parsed.messages[2].content).toBe('我是AI');
    expect(parsed.inputTokens).toBe(8);
    expect(parsed.outputTokens).toBe(5);
  });
});

describe('parseConversation - Anthropic 流式', () => {
  it('解析 system + user + assistant 流（SSE events）', () => {
    const req = JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: '你是Claude',
      messages: [{ role: 'user', content: '写个hello world' }],
    });
    const sse = [
      'event: message_start',
      'data: {"message":{"id":"msg_1","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":10,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", world"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":2}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const parsed = parseConversation(
      'https://api.minimaxi.com/anthropic/v1/messages',
      req,
      sse,
      'text/event-stream',
    );
    expect(parsed.protocol).toBe('anthropic.messages');
    expect(parsed.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(parsed.messages[2].content).toBe('Hello, world');
    expect(parsed.inputTokens).toBe(10);
    expect(parsed.outputTokens).toBe(2);
  });

  it('tool_use 拆成单独 tool 消息', () => {
    const req = JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '我需要查一下' },
            { type: 'tool_use', name: 'get_weather', input: { city: '北京' } },
          ],
        },
      ],
    });
    const parsed = parseConversation(
      'https://api.anthropic.com/v1/messages',
      req,
      '',
      null,
    );
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('assistant');
    expect(parsed.messages[0].content).toBe('我需要查一下');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].content).toContain('get_weather');
    expect(parsed.messages[1].content).toContain('北京');
  });
});

describe('parseConversation - Gemini 流式', () => {
  it('解析 user + model + token stats', () => {
    const req = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}',
      '',
    ].join('\n');
    const parsed = parseConversation(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent',
      req,
      sse,
      'text/event-stream',
    );
    expect(parsed.protocol).toBe('gemini.generateContent');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].content).toBe('Hello');
    expect(parsed.inputTokens).toBe(3);
    expect(parsed.outputTokens).toBe(2);
  });
});

describe('makePreview', () => {
  it('取最后一条 assistant/user 消息前 60 字符', () => {
    const preview = makePreview({
      protocol: 'openai.chat',
      messages: [
        { role: 'user', content: 'a'.repeat(100) },
        { role: 'assistant', content: '你好世界' },
      ],
    });
    expect(preview).toBe('你好世界');
  });

  it('空消息返回 (空)', () => {
    expect(makePreview({ protocol: 'unknown', messages: [] })).toBe('(空)');
  });

  it('长消息截断带 …', () => {
    const preview = makePreview({
      protocol: 'openai.chat',
      messages: [{ role: 'user', content: 'a'.repeat(100) }],
    });
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBe(61);
  });
});

describe('matchesPattern', () => {
  it('origin + path 前缀匹配', () => {
    expect(
      matchesPattern(
        'https://api.minimaxi.com/anthropic/v1/messages',
        'https://api.minimaxi.com/anthropic',
      ),
    ).toBe(true);
  });

  it('origin 匹配该 origin 下所有', () => {
    expect(
      matchesPattern('https://api.minimaxi.com/anything', 'https://api.minimaxi.com'),
    ).toBe(true);
  });

  it('不同 origin 不匹配', () => {
    expect(matchesPattern('https://other.com/foo', 'https://api.minimaxi.com')).toBe(false);
  });

  it('origin 匹配但 path 不匹配时不匹配', () => {
    expect(
      matchesPattern(
        'https://api.minimaxi.com/other',
        'https://api.minimaxi.com/anthropic',
      ),
    ).toBe(false);
  });
});