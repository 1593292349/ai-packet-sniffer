/**
 * JSON 文件持久化实现
 * 启动时一次性加载到内存，写入采用节流+原子重命名
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StoreData } from './types';

export class JsonStore {
  private data: StoreData;
  private filePath: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.data = this.load();
  }

  private emptyData(): StoreData {
    return {
      addresses: [],
      conversations: [],
      messages: [],
      raw_requests: [],
      _nextIds: { address: 1, conversation: 1, message: 1, raw: 1 },
    };
  }

  private load(): StoreData {
    if (fs.existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        // 兼容字段缺失
        parsed._nextIds ??= { address: 1, conversation: 1, message: 1, raw: 1 };
        parsed.addresses ??= [];
        parsed.conversations ??= [];
        parsed.messages ??= [];
        parsed.raw_requests ??= [];
        return parsed;
      } catch {
        // 文件损坏，备份后重建
        try {
          fs.renameSync(this.filePath, this.filePath + '.broken-' + Date.now());
        } catch {}
      }
    }
    const data = this.emptyData();
    this.writeSync(data);
    return data;
  }

  private writeSync(data: StoreData) {
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.filePath);
  }

  /** 节流写盘（200ms） */
  scheduleFlush() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      try {
        this.writeSync(this.data);
      } catch (e) {
        console.error('[store] flush error', e);
      }
    }, 200);
  }

  /** 立即同步写盘（用于关闭时） */
  flushSync() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeSync(this.data);
  }

  // 底层访问（供 Repo 使用）
  getData(): StoreData {
    return this.data;
  }

  nextId(table: 'address' | 'conversation' | 'message' | 'raw'): number {
    return this.data._nextIds[table]++;
  }

  close() {
    this.flushSync();
  }
}