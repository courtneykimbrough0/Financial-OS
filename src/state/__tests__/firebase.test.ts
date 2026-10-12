import { describe, expect, it } from 'vitest';
import { handleFirestoreError, OperationType, type FirestoreErrorInfo } from '../firebase';

describe('Firebase Error Handler', () => {
  it('serializes errors and redacts any user ID from paths', () => {
    let thrown: Error | null = null;
    try {
      handleFirestoreError(new Error('Missing or insufficient permissions.'), OperationType.WRITE, 'financialData/secret-user-123');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    const parsed = JSON.parse(thrown!.message) as FirestoreErrorInfo;
    expect(parsed.error).toBe('Missing or insufficient permissions.');
    expect(parsed.operationType).toBe('write');
    // UID must be sanitized to avoid leaking UID in logs
    expect(parsed.path).toBe('financialData/[uid]');
  });

  it('handles non-Error objects gracefully and without PII', () => {
    let thrown: Error | null = null;
    try {
      handleFirestoreError('Network failure', OperationType.GET, null);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    const parsed = JSON.parse(thrown!.message) as FirestoreErrorInfo;
    expect(parsed.error).toBe('Network failure');
    expect(parsed.operationType).toBe('get');
    expect(parsed.path).toBeNull();
  });
});
