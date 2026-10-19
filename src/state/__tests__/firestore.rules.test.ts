/**
 * Runs `firestore.rules` in the Firestore emulator (`npm run test:rules`) and
 * checks every invariant in security_spec.md, then exercises the app's
 * Firestore storage code (`firebaseBackend`) against those same rules.
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import firebaseJson from '../../../firebase.json';
import { addOneTime, emptyData } from '../../domain/operations';
import { CloudAccessError } from '../cloud';
import { COLLECTION, firebaseBackend } from '../firebase';

const PROJECT = 'demo-financial-os';
const DATABASE = firebaseJson.firestore[0]!.database;
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088').split(':') as [string, string];

const apps: FirebaseApp[] = [];
/** A Firestore client signed in as `uid`, or signed out when uid is null. */
function client(uid: string | null): Firestore {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'test' }, `client-${apps.length}`);
  apps.push(app);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true }, DATABASE);
  connectFirestoreEmulator(db, HOST, Number(PORT), uid ? { mockUserToken: { user_id: uid, sub: uid } } : undefined);
  return db;
}

const alice = client('alice');
const bob = client('bob');
const anon = client(null);

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)));
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
});

function forecast(uid: string, revision: number, extra: Record<string, unknown> = {}) {
  return { userId: uid, schemaVersion: 2, revision, onboardingComplete: false, sources: [], records: [], updatedAt: serverTimestamp(), ...extra };
}
const ref = (db: Firestore, uid: string) => doc(db, COLLECTION, uid);

async function allowed(p: Promise<unknown>) {
  await expect(p).resolves.not.toThrow();
}
async function denied(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: 'permission-denied' });
}

describe('firestore.rules', () => {
  it('lets a user create, read, update and delete their own forecast', async () => {
    await allowed(setDoc(ref(alice, 'alice'), forecast('alice', 1)));
    expect((await getDoc(ref(alice, 'alice'))).data()?.revision).toBe(1);
    await allowed(setDoc(ref(alice, 'alice'), forecast('alice', 2)));
    await allowed(deleteDoc(ref(alice, 'alice')));
  });

  it('denies signed-out reads and writes', async () => {
    await setDoc(ref(alice, 'alice'), forecast('alice', 1));
    await denied(getDoc(ref(anon, 'alice')));
    await denied(setDoc(ref(anon, 'anon'), forecast('anon', 1)));
    await denied(deleteDoc(ref(anon, 'alice')));
  });

  it('denies reading, writing or deleting another user’s forecast', async () => {
    await setDoc(ref(alice, 'alice'), forecast('alice', 1));
    await denied(getDoc(ref(bob, 'alice')));
    await denied(setDoc(ref(bob, 'alice'), forecast('alice', 2)));
    await denied(deleteDoc(ref(bob, 'alice')));
    expect((await getDoc(ref(alice, 'alice'))).data()?.revision).toBe(1);
  });

  it('denies listing the collection, even for your own document', async () => {
    await setDoc(ref(alice, 'alice'), forecast('alice', 1));
    await denied(getDocs(collection(alice, COLLECTION)));
  });

  it('denies a forecast whose userId isn’t the caller', async () => {
    await denied(setDoc(ref(alice, 'alice'), forecast('bob', 1)));
  });

  it('denies extra fields', async () => {
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1, { isAdmin: true })));
  });

  it('denies missing fields and wrong types', async () => {
    const { sources: _sources, ...noSources } = forecast('alice', 1);
    await denied(setDoc(ref(alice, 'alice'), noSources));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1, { revision: '1' })));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1, { sources: 'none' })));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1, { onboardingComplete: 'yes' })));
  });

  it('accepts an optional review rhythm of the right shape, and nothing else under that name', async () => {
    const review = { cadence: 'weekly', handledOn: '2026-10-14', outcome: 'completed' };
    await allowed(setDoc(ref(alice, 'alice'), forecast('alice', 1, { review })));
    await allowed(setDoc(ref(alice, 'alice'), forecast('alice', 2, { review: { cadence: 'off', handledOn: null, outcome: null } })));
    for (const bad of [
      { ...review, cadence: 'daily' },
      { ...review, outcome: 'done' },
      { ...review, handledOn: 20261014 },
      { ...review, handledOn: '2026-10-14T00:00:00Z' },
      { cadence: 'weekly', handledOn: null },
      { ...review, extra: true },
      'weekly',
    ]) {
      await denied(setDoc(ref(alice, 'alice'), forecast('alice', 3, { review: bad })));
    }
  });

  it('requires the first save to be revision 1', async () => {
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 2)));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 0)));
  });

  it('requires every update to raise the revision by exactly one', async () => {
    await setDoc(ref(alice, 'alice'), forecast('alice', 1));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1)));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 3)));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 0)));
    await allowed(setDoc(ref(alice, 'alice'), forecast('alice', 2)));
  });

  it('requires updatedAt to be the server’s time', async () => {
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1, { updatedAt: Timestamp.fromDate(new Date('2026-01-01')) })));
    await denied(setDoc(ref(alice, 'alice'), forecast('alice', 1, { updatedAt: '2026-10-11T00:00:00Z' })));
  });

  it('denies every other collection', async () => {
    await denied(setDoc(doc(alice, 'users', 'alice'), { id: 'alice' }));
    await denied(getDoc(doc(alice, 'test', 'connection')));
  });
});

describe('firebaseBackend against the rules', () => {
  const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };
  function withBill(name: string) {
    const r = addOneTime(emptyData(), { kind: 'varied', description: name, amountCents: 1000, date: '2026-10-20' }, clock, name);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  it('saves with revisions, rejects stale saves, loads and removes', async () => {
    const backend = firebaseBackend(alice, 'alice');
    expect(await backend.fetch()).toBeNull();
    expect(await backend.save(withBill('A'), 0)).toBe(1);
    expect(await backend.save(withBill('B'), 0)).toBeNull();
    expect(await backend.save(withBill('B'), 1)).toBe(2);
    expect(await backend.save(withBill('C'), 1)).toBeNull();
    const stored = await backend.fetch();
    expect(stored?.revision).toBe(2);
    expect((stored?.data as { records: { description: string }[] }).records.map((r) => r.description)).toEqual(['B']);
    await backend.remove();
    expect(await backend.fetch()).toBeNull();
  });

  it('reports a refused request as an access error, not as offline', async () => {
    await firebaseBackend(alice, 'alice').save(withBill('A'), 0);
    const intruder = firebaseBackend(bob, 'alice');
    await expect(intruder.fetch()).rejects.toBeInstanceOf(CloudAccessError);
    await expect(intruder.save(withBill('X'), 1)).rejects.toBeInstanceOf(CloudAccessError);
    await expect(intruder.remove()).rejects.toBeInstanceOf(CloudAccessError);
  });
});
