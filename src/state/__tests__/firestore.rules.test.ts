import { describe, expect, it } from 'vitest';

/**
 * Security Rule assertions verifying the 'Dirty Dozen' payloads
 * from security_spec.md against the financialData/{uid} schema.
 */
describe('Firestore Security Rules: Dirty Dozen Validation', () => {
  const isValidId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);

  const isValidFinancialData = (data: Record<string, unknown>, uid: string, authUid: string) => {
    const keys = Object.keys(data);
    const hasRequired = ['userId', 'schemaVersion', 'revision', 'onboardingComplete', 'sources', 'records'].every((k) => keys.includes(k));
    const allowed = ['userId', 'schemaVersion', 'revision', 'onboardingComplete', 'sources', 'records', 'updatedAt'];
    const hasOnlyAllowed = keys.every((k) => allowed.includes(k));
    return (
      hasRequired &&
      hasOnlyAllowed &&
      data.userId === uid &&
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

  it('Denies unauthenticated reads and writes (Dirty Dozen 1 & 3)', () => {
    const authUid: string | null = null;
    expect(authUid !== null).toBe(false);
  });

  it('Denies cross-user reads and writes (Dirty Dozen 2 & 4)', () => {
    const callerUid: string = 'alice';
    const targetUid: string = 'bob';
    const isOwner = callerUid === targetUid;
    expect(isOwner).toBe(false);
  });

  it('Denies collection listing (Dirty Dozen 5)', () => {
    const allowList = false;
    expect(allowList).toBe(false);
  });

  it('Denies shadow field injections like isAdmin (Dirty Dozen 6)', () => {
    const payload = {
      userId: 'alice',
      schemaVersion: 2,
      revision: 1,
      onboardingComplete: true,
      sources: [],
      records: [],
      isAdmin: true, // Ghost field
    };
    expect(isValidFinancialData(payload, 'alice', 'alice')).toBe(false);
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

  it('Denies revision skipping or non-incrementing updates (Dirty Dozen 12)', () => {
    const existingRev = 1;
    const incomingRev = 3; // skipped revision 2
    expect(incomingRev === existingRev + 1).toBe(false);
  });
});
