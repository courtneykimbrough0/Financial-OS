import { describe, expect, it } from 'vitest';
import { handleFirestoreError, OperationType, type FirestoreErrorInfo } from '../firebase';

describe('Firebase Error Handler', () => {
  it('serializes errors to the specified JSON schema', () => {
    let thrown: Error | null = null;
    try {
      handleFirestoreError(new Error('Missing or insufficient permissions.'), OperationType.WRITE, 'users/user-123/data/current');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    const parsed = JSON.parse(thrown!.message) as FirestoreErrorInfo;
    expect(parsed.error).toBe('Missing or insufficient permissions.');
    expect(parsed.operationType).toBe('write');
    expect(parsed.path).toBe('users/user-123/data/current');
    expect(parsed.authInfo).toBeDefined();
  });

  it('handles non-Error objects gracefully', () => {
    let thrown: Error | null = null;
    try {
      handleFirestoreError('Network failure', OperationType.GET, 'users/user-123');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    const parsed = JSON.parse(thrown!.message) as FirestoreErrorInfo;
    expect(parsed.error).toBe('Network failure');
    expect(parsed.operationType).toBe('get');
    expect(parsed.path).toBe('users/user-123');
  });
});
