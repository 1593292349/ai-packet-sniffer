/**
 * SSE (Server-Sent Events) 解析工具
 */

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * 把 SSE 流（"event: ...\ndata: ...\n\n"）拆成事件数组。
 * 多行 data 用 \n 拼接。
 */
export function splitSSE(body: string): SSEEvent[] {
  const out: SSEEvent[] = [];
  const lines = body.split(/\r?\n/);
  let curEvent: string | undefined;
  let curData: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue; // 注释
    if (line === '') {
      if (curData.length) {
        out.push({ event: curEvent, data: curData.join('\n') });
        curEvent = undefined;
        curData = [];
      }
      continue;
    }
    const idx = line.indexOf(':');
    const field = idx >= 0 ? line.slice(0, idx) : line;
    let value = idx >= 0 ? line.slice(idx + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') curEvent = value;
    else if (field === 'data') curData.push(value);
  }
  if (curData.length) out.push({ event: curEvent, data: curData.join('\n') });
  return out;
}

export function safeParse(s: string | null | undefined): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function asString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}