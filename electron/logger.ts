/**
 * 统一日志
 * - console 输出（开发）
 * - 写文件 %APPDATA%\ai-packet-sniffer\logs\sniffer-YYYY-MM-DD.log
 * - 通过 IPC 推送给渲染层（可选）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
  meta?: any;
}

type Listener = (e: LogEntry) => void;

export class Logger {
  private filePath: string;
  private listeners: Listener[] = [];
  private writeStream: fs.WriteStream | null = null;

  constructor(logDir: string) {
    fs.mkdirSync(logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    this.filePath = path.join(logDir, `sniffer-${day}.log`);
    this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' });
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(level: LogLevel, msg: string, meta?: any) {
    const entry: LogEntry = { ts: Date.now(), level, msg, meta };
    const line = `[${new Date(entry.ts).toISOString()}] ${level.toUpperCase()} ${msg}${
      meta ? ' ' + safeStringify(meta) : ''
    }\n`;
    // 控制台
    if (level === 'error') console.error(line.trimEnd());
    else if (level === 'warn') console.warn(line.trimEnd());
    else console.log(line.trimEnd());
    // 文件
    if (this.writeStream && !this.writeStream.destroyed) {
      this.writeStream.write(line);
    }
    // 监听器
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {}
    }
  }

  debug(msg: string, meta?: any) {
    this.emit('debug', msg, meta);
  }
  info(msg: string, meta?: any) {
    this.emit('info', msg, meta);
  }
  warn(msg: string, meta?: any) {
    this.emit('warn', msg, meta);
  }
  error(msg: string, meta?: any) {
    this.emit('error', msg, meta);
  }

  close() {
    if (this.writeStream && !this.writeStream.destroyed) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}