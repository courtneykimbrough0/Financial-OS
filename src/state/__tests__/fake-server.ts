import type { AppData } from '../../domain/types';
import type { CloudBackend } from '../cloud';

/** Behaves like the save_financial_data function; `offline` makes every call fail. */
export class FakeServer implements CloudBackend {
  row: { data: AppData; revision: number } | null = null;
  offline = false;
  saves = 0;
  private check() {
    if (this.offline) throw new Error('Failed to fetch');
  }
  async fetch() {
    this.check();
    return this.row ? structuredClone(this.row) : null;
  }
  async save(data: AppData, base: number) {
    this.check();
    if ((this.row?.revision ?? 0) !== base) return null;
    this.saves += 1;
    this.row = { data: structuredClone(data), revision: base + 1 };
    return base + 1;
  }
  async remove() {
    this.check();
    this.row = null;
  }
  /** Another device saves. */
  saveElsewhere(data: AppData) {
    this.row = { data, revision: (this.row?.revision ?? 0) + 1 };
  }
}

