import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import type { AppData } from '../domain/types';
import type { CloudBackend } from './cloud';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection check on boot
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export async function ensureUserDoc(userId: string, email: string): Promise<void> {
  const userPath = `users/${userId}`;
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      const now = new Date().toISOString();
      await setDoc(userRef, {
        id: userId,
        email: email || auth.currentUser?.email || '',
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('permission')) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }
  }
}

/**
 * Creates a CloudBackend implementation backed by Firebase Firestore.
 * Supports optimistic concurrency control via document revisions.
 */
export function firebaseBackend(userId: string): CloudBackend {
  const userPath = `users/${userId}`;
  const dataDocPath = `users/${userId}/data/current`;

  return {
    async fetch() {
      try {
        const docRef = doc(db, 'users', userId, 'data', 'current');
        const snap = await getDoc(docRef);
        if (!snap.exists()) return null;
        const raw = snap.data();
        return { data: raw, revision: Number(raw.revision || 0) };
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, dataDocPath);
      }
    },

    async save(data: AppData, baseRevision: number): Promise<number | null> {
      await ensureUserDoc(userId, auth.currentUser?.email || '');

      try {
        const docRef = doc(db, 'users', userId, 'data', 'current');
        const result = await runTransaction(db, async (tx) => {
          const snap = await tx.get(docRef);
          const now = new Date().toISOString();

          if (!snap.exists()) {
            if (baseRevision !== 0) return null;
            const newDoc = {
              userId,
              schemaVersion: 2,
              revision: 1,
              onboardingComplete: Boolean(data.onboardingComplete),
              sources: data.sources || [],
              records: data.records || [],
              updatedAt: now,
            };
            tx.set(docRef, newDoc);
            return 1;
          }

          const existing = snap.data();
          if (Number(existing.revision || 0) !== baseRevision) {
            return null; // Optimistic concurrency conflict
          }

          const nextRev = baseRevision + 1;
          const updatedDoc = {
            userId,
            schemaVersion: 2,
            revision: nextRev,
            onboardingComplete: Boolean(data.onboardingComplete),
            sources: data.sources || [],
            records: data.records || [],
            updatedAt: now,
          };
          tx.update(docRef, updatedDoc);
          return nextRev;
        });

        return result;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, dataDocPath);
      }
    },

    async remove(): Promise<void> {
      try {
        const docRef = doc(db, 'users', userId, 'data', 'current');
        await deleteDoc(docRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, dataDocPath);
      }

      try {
        const userRef = doc(db, 'users', userId);
        await deleteDoc(userRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, userPath);
      }
    },
  };
}
