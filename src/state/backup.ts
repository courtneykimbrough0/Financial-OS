/**
 * Backups: the user's data as one JSON file they can download and later
 * restore, on this device or another. The file wraps the same versioned
 * document the app stores, so restoring runs the same validation and upgrade
 * path as loading saved data.
 */
import { todayLocal } from '../domain/dates';
import type { AppData } from '../domain/types';
import { migrate } from './storage';

export const BACKUP_FORMAT = 'financial-os-backup';

interface BackupFile {
  format: typeof BACKUP_FORMAT;
  exportedAt: string;
  data: AppData;
}

export function createBackup(data: AppData, now: Date = new Date()): { filename: string; text: string } {
  const { isSample: _sample, ...rest } = data;
  const file: BackupFile = { format: BACKUP_FORMAT, exportedAt: now.toISOString(), data: rest };
  return { filename: `financial-os-backup-${todayLocal(now)}.json`, text: JSON.stringify(file, null, 2) };
}

export interface ParsedBackup {
  data: AppData;
  exportedAt: string | null;
  itemCount: number;
}

/** Reads a backup file's text. Throws an Error with a plain-language message if it can't be used. */
export function readBackup(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t a Financial OS backup.');
  }
  const file = parsed as Partial<BackupFile>;
  if (!file || typeof file !== 'object' || file.format !== BACKUP_FORMAT || !file.data) {
    throw new Error('This file isn’t a Financial OS backup.');
  }
  let data: AppData;
  try {
    data = migrate(file.data);
  } catch {
    throw new Error('This backup is damaged or from a newer version of the app, so it can’t be restored.');
  }
  const { isSample: _sample, ...rest } = data;
  return {
    data: rest,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : null,
    itemCount: data.sources.length + data.records.filter((r) => r.sourceId === null).length,
  };
}
