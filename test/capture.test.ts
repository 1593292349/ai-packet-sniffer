import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureService } from '../electron/capture';
import type { Logger } from '../electron/logger';
import type { CaptureContext } from '../electron/proxy';
import { Store } from '../electron/store';

function makeContext(url: string, method: string, reqBody = '', respBody = ''): CaptureContext {
  return {
    url,
    method,
    reqHeaders: {},
    reqBody,
    respStatus: 200,
    respHeaders: { 'content-type': 'application/json' },
    respBody,
    respCT: 'application/json',
    startedAt: 1,
    endedAt: 2,
    clientAddr: '127.0.0.1',
  };
}

describe('CaptureService', () => {
  it('保存不带 /v1 前缀的 DeepSeek 对话请求', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.deepseek.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(
        makeContext(
          'https://api.deepseek.com/chat/completions',
          'POST',
          JSON.stringify({
            model: 'deepseek-v4-flash',
            messages: [{ role: 'user', content: '你好' }],
          }),
          JSON.stringify({
            model: 'deepseek-v4-flash',
            choices: [{ message: { role: 'assistant', content: '你好' } }],
          }),
        ),
      );

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].url).toBe('https://api.deepseek.com/chat/completions');
      expect(conversations[0].message_count).toBe(2);
      expect(store.json.getData().raw_requests).toHaveLength(1);
      expect(address.hit_count).toBe(1);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('保存监听域名下任意路径的对话请求', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(
        makeContext(
          'https://api.example.com/gateway/any-custom-path',
          'POST',
          JSON.stringify({
            model: 'custom-model',
            messages: [{ role: 'user', content: '你好' }],
          }),
          JSON.stringify({
            model: 'custom-model',
            choices: [{ message: { role: 'assistant', content: '你好' } }],
          }),
        ),
      );

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].url).toBe('https://api.example.com/gateway/any-custom-path');
      expect(conversations[0].message_count).toBe(2);
      expect(address.hit_count).toBe(1);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('保存任意路径的 Responses 字符串输入请求', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(
        makeContext(
          'https://api.example.com/custom/respond',
          'POST',
          JSON.stringify({ input: '你好' }),
          JSON.stringify({
            model: 'custom-model',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: '你好' }],
              },
            ],
          }),
        ),
      );

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].message_count).toBe(2);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('保存由服务端选择默认模型的对话请求', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(
        makeContext(
          'https://api.example.com/custom/chat',
          'POST',
          JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }),
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: '你好' } }] }),
        ),
      );

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].message_count).toBe(2);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('按请求头识别任意路径的 Anthropic 对话', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);
      const context = makeContext(
        'https://api.example.com/custom/generate',
        'POST',
        JSON.stringify({
          model: 'claude-custom',
          system: '系统提示',
          max_tokens: 1024,
          messages: [{ role: 'user', content: '你好' }],
        }),
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          model: 'claude-custom',
          content: [{ type: 'text', text: '你好' }],
        }),
      );
      context.reqHeaders = { 'anthropic-version': '2023-06-01' };
      service.handle(context);

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].message_count).toBe(3);
      const raw = store.json.getData().raw_requests[0];
      expect(raw.protocol).toBe('anthropic.messages');
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('保存监听域名下任意路径的 Gemini 对话', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(
        makeContext(
          'https://api.example.com/custom/generate',
          'POST',
          JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: '你好' }] }],
          }),
          JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: '你好' }] } }],
          }),
        ),
      );

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].message_count).toBe(2);
      expect(store.json.getData().raw_requests[0].protocol).toBe('gemini.generateContent');
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'GET 对话请求',
      url: 'https://api.example.com/v1/chat/completions',
      method: 'GET',
      body: { messages: [{ role: 'user', content: '你好' }] },
    },
    {
      name: 'Responses input tokens',
      url: 'https://api.example.com/v1/responses/input_tokens',
      method: 'POST',
      body: { input: '你好' },
    },
    {
      name: 'Gemini countTokens',
      url: 'https://api.example.com/v1beta/models/gemini:countTokens',
      method: 'POST',
      body: { contents: [{ role: 'user', parts: [{ text: '你好' }] }] },
    },
  ])('不保存 $name', ({ url, method, body }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);
      service.handle(makeContext(url, method, JSON.stringify(body)));

      expect(store.conversations.listByAddress(address.id)).toHaveLength(0);
      expect(store.json.getData().raw_requests).toHaveLength(0);
      expect(address.hit_count).toBe(0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('不将任意路径的语音合成 input 请求保存为 Responses 对话', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);
      const context = makeContext(
        'https://api.example.com/custom/synthesize',
        'POST',
        JSON.stringify({ model: 'tts-model', input: '你好', voice: 'alloy' }),
        'binary-audio',
      );
      context.respHeaders = { 'content-type': 'audio/mpeg' };
      context.respCT = 'audio/mpeg';
      service.handle(context);

      expect(store.conversations.listByAddress(address.id)).toHaveLength(0);
      expect(store.json.getData().raw_requests).toHaveLength(0);
      expect(address.hit_count).toBe(0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('不保存 POST models 和 props 请求', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);
      const chatBody = JSON.stringify({ messages: [{ role: 'user', content: '你好' }] });

      service.handle(makeContext('https://api.example.com/v1/models', 'POST', chatBody));
      service.handle(makeContext('https://api.example.com/v1/props', 'POST', chatBody));

      expect(store.conversations.listByAddress(address.id)).toHaveLength(0);
      expect(store.json.getData().raw_requests).toHaveLength(0);
      expect(address.hit_count).toBe(0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('不保存已知对话 URL 下语义无效的请求体', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(
        makeContext('https://api.example.com/v1/responses', 'POST', JSON.stringify({})),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1/responses',
          'POST',
          JSON.stringify({ input: [null] }),
        ),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1/chat/completions',
          'POST',
          JSON.stringify({ model: 'text-embedding-3-small', input: '你好' }),
        ),
      );
      service.handle(
        makeContext('https://api.example.com/v1/messages', 'POST', '{invalid-json'),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1beta/models/gemini:generateContent',
          'POST',
          JSON.stringify({ contents: [] }),
        ),
      );

      expect(store.conversations.listByAddress(address.id)).toHaveLength(0);
      expect(store.json.getData().raw_requests).toHaveLength(0);
      expect(address.hit_count).toBe(0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('只保存正常的对话请求', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-'));
    const store = new Store(path.join(dir, 'store.json'));
    const logger = { debug() {}, error() {} } as Logger;

    try {
      const address = store.addresses.add('https://api.example.com');
      const service = new CaptureService(store, () => null, logger);

      service.handle(makeContext('https://api.example.com/v1/models', 'GET'));
      service.handle(
        makeContext(
          'https://api.example.com/v1/messages/count_tokens',
          'POST',
          JSON.stringify({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: '你好' }] }),
        ),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1/responses/compact',
          'POST',
          JSON.stringify({ model: 'gpt-4o', input: '你好' }),
        ),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1/embeddings',
          'POST',
          JSON.stringify({ model: 'text-embedding-3-small', input: '你好' }),
          JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
        ),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1/moderations',
          'POST',
          JSON.stringify({ model: 'omni-moderation-latest', input: '你好' }),
          JSON.stringify({ results: [{ flagged: false }] }),
        ),
      );
      service.handle(
        makeContext(
          'https://api.example.com/v1/responses',
          'POST',
          JSON.stringify({ model: 'gpt-4o', input: '你好' }),
          JSON.stringify({
            model: 'gpt-4o',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: '你好' }],
              },
            ],
          }),
        ),
      );

      const conversations = store.conversations.listByAddress(address.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].url).toBe('https://api.example.com/v1/responses');
      expect(store.json.getData().raw_requests).toHaveLength(1);
      expect(address.hit_count).toBe(1);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
