import type { JsonStore } from '../jsonStore';
import type { AddressRow } from '../types';

export class AddressRepo {
  constructor(private store: JsonStore) {}

  list(): AddressRow[] {
    return [...this.store.getData().addresses].sort((a, b) => b.id - a.id);
  }

  getById(id: number): AddressRow | undefined {
    return this.store.getData().addresses.find((a) => a.id === id);
  }

  findByOrigin(origin: string): AddressRow | undefined {
    return this.store
      .getData()
      .addresses.find((a) => a.pattern === origin || a.pattern === origin + '/');
  }

  /** 已存在则返回旧记录（不重复创建） */
  add(pattern: string, label?: string): AddressRow {
    const data = this.store.getData();
    const exists = data.addresses.find((a) => a.pattern === pattern);
    if (exists) return exists;
    const row: AddressRow = {
      id: this.store.nextId('address'),
      pattern,
      label: label ?? null,
      enabled: 1,
      created_at: Date.now(),
      last_hit_at: null,
      hit_count: 0,
    };
    data.addresses.push(row);
    this.store.scheduleFlush();
    return row;
  }

  delete(id: number): void {
    const data = this.store.getData();
    data.addresses = data.addresses.filter((a) => a.id !== id);
    // 级联清理
    data.conversations = data.conversations.filter((c) => c.address_id !== id);
    const convIds = new Set(data.conversations.map((c) => c.id));
    data.messages = data.messages.filter((m) => convIds.has(m.conversation_id));
    data.raw_requests = data.raw_requests.filter((r) => r.address_id !== id);
    this.store.scheduleFlush();
  }

  toggle(id: number, enabled: boolean): void {
    const a = this.getById(id);
    if (a) {
      a.enabled = enabled ? 1 : 0;
      this.store.scheduleFlush();
    }
  }

  recordHit(id: number): void {
    const a = this.getById(id);
    if (a) {
      a.last_hit_at = Date.now();
      a.hit_count += 1;
      this.store.scheduleFlush();
    }
  }
}