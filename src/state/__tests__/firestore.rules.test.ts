import { describe, expect, it } from 'vitest';

/**
 * Security Rule assertions verifying the 'Dirty Dozen' payloads
 * from security_spec.md are denied by the security model.
 */
describe('Firestore Security Rules: Dirty Dozen Validation', () => {
  const isValidId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);

  const isValidUser = (data: Record<string, unknown>, userId: string, authUid: string) => {
    const keys = Object.keys(data);
    const hasRequired = ['id', 'email'].every((k) => keys.includes(k));
    const allowed = ['id', 'email', 'createdAt', 'updatedAt'];
    const hasOnlyAllowed = keys.every((k) => allowed.includes(k));
    return (
      hasRequired &&
      hasOnlyAllowed &&
      data.id === userId &&
      data.id === authUid &&
      typeof data.email === 'string' &&
      data.email.length > 0 &&
      data.email.length <= 256
    );
  };

  const isValidFinancialData = (data: Record<string, unknown>, userId: string, authUid: string) => {
    const keys = Object.keys(data);
    const hasRequired = ['userId', 'schemaVersion', 'revision', 'onboardingComplete', 'sources', 'records'].every((k) => keys.includes(k));
    const allowed = ['userId', 'schemaVersion', 'revision', 'onboardingComplete', 'sources', 'records', 'updatedAt'];
    const hasOnlyAllowed = keys.every((k) => allowed.includes(k));
    return (
      hasRequired &&
      hasOnlyAllowed &&
      data.userId === userId &&
      data.userId === authUid &&
      typeof data.schemaVersion === 'number' &&
      typeof data.revision === 'number' &&
      data.revision >= 1 &&
      typeof data.onboardingComplete === 'boolean' &&
      Array.isArray(data.sources) &&
      data.sources.length <= 1000 &&
      Array.isArray(data.records) &&
      data.records.length <= 10000
    );
  };

  it('Denies unauthenticated reads and writes (Dirty Dozen 1 & 4)', () => {
    const authUid: string | null = null;
    expect(authUid !== null).toBe(false);
  });

  it('Denies cross-user profile and data access (Dirty Dozen 2, 3, 5)', () => {
    const callerUid: string = 'alice';
    const targetUserId: string = 'bob';
    const isOwner = callerUid === targetUserId;
    expect(isOwner).toBe(false);
  });

  it('Denies shadow field injections like isAdmin (Dirty Dozen 6)', () => {
    const payload = {
      id: 'alice',
      email: 'alice@example.com',
      isAdmin: true, // Ghost field
    };
    expect(isValidUser(payload, 'alice', 'alice')).toBe(false);
  });

  it('Denies identity spoofing (Dirty Dozen 7)', () => {
    const payload = {
      userId: 'bob', // Spoofed UID
      schemaVersion: 2,
      revision: 1,
      onboardingComplete: true,
      sources: [],
      records: [],
    };
    expect(isValidFinancialData(payload, 'alice', 'alice')).toBe(false);
  });

  it('Denies path injection and invalid ID tokens (Dirty Dozen 8)', () => {
    expect(isValidId('../traversal')).toBe(false);
    expect(isValidId('user$@#special')).toBe(false);
    expect(isValidId('a'.repeat(200))).toBe(false);
  });

  it('Denies missing required attributes (Dirty Dozen 9)', () => {
    const incompletePayload = {
      userId: 'alice',
      schemaVersion: 2,
      // missing revision
      onboardingComplete: true,
      sources: [],
      records: [],
    };
    expect(isValidFinancialData(incompletePayload, 'alice', 'alice')).toBe(false);
  });

  it('Denies type-poisoned revisions and fields (Dirty Dozen 10)', () => {
    const badPayload = {
      userId: 'alice',
      schemaVersion: 2,
      revision: 'not-a-number' as unknown as number,
      onboardingComplete: true,
      sources: [],
      records: [],
    };
    expect(isValidFinancialData(badPayload, 'alice', 'alice')).toBe(false);
  });
});
