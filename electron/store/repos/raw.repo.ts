import type { JsonStore } from '../jsonStore';
import type { RawRequestRow } from '../types';

export interface InsertRawRequestInput {
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

export class RawRepo {
  constructor(private store: JsonStore) {}

  insert(input: InsertRawRequestInput): number {
    const data = this.store.getData();
    const row: RawRequestRow = { id: this.store.nextId('raw'), ...input };
    data.raw_requests.push(row);
    this.store.scheduleFlush();
    return row.id;
  }

  getById(id: number): RawRequestRow | undefined {
    return this.store.getData().raw_requests.find((r) => r.id === id);
  }
}