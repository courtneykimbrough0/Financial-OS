import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { AppData } from '../domain/types';
import { CloudAdapter, type CloudBackend } from './cloud';
import type { AccountUser, AuthService } from './account';
import firebaseConfig from '../../firebase-applet-config.json';

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
}

/**
 * Sanitizes and formats Firestore errors.
 * Never logs or exposes user email, uid, or provider details.
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const message = error instanceof Error ? error.message : String(error);
  const sanitizedPath = path ? path.replace(/financialData\/[a-zA-Z0-9_-]+/g, 'financialData/[uid]') : null;
  const errInfo: FirestoreErrorInfo = {
    error: message.includes('permission') ? 'Missing or insufficient permissions.' : message,
    operationType,
    path: sanitizedPath,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let firebaseInstance: {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} | null = null;

let startingPromise: Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}> | null = null;

/**
 * Initializes Firebase, App Check with reCAPTCHA Enterprise, and services on demand.
 * Leaves App Check enforcement off for now.
 */
export async function startFirebase(): Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}> {
  if (firebaseInstance) return firebaseInstance;
  if (startingPromise) return startingPromise;

  startingPromise = (async () => {
    const { initializeApp } = await import('firebase/app');
    const { getAuth } = await import('firebase/auth');
    const { getFirestore, doc, getDocFromServer } = await import('firebase/firestore');

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

    // Register App Check with reCAPTCHA Enterprise if site key is configured
    if (typeof window !== 'undefined' && firebaseConfig.recaptchaSiteKey) {
      try {
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(firebaseConfig.recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (err) {
        console.warn('App Check initialization deferred:', err instanceof Error ? err.message : String(err));
      }
    }

    // Validate connection to Firestore
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (err) {
      if (err instanceof Error && err.message.includes('the client is offline')) {
        console.warn('Firebase client is offline.');
      }
    }

    firebaseInstance = { app, auth, db };
    return firebaseInstance;
  })();

  return startingPromise;
}

/**
 * CloudBackend implementation for Firestore storing data at financialData/{uid}.
 * Optimistic concurrency control via revision == resource.data.revision + 1.
 */
export function firebaseBackend(uid: string): CloudBackend {
  const docPath = `financialData/${uid}`;

  return {
    async fetch() {
      try {
        const { db } = await startFirebase();
        const { doc, getDoc } = await import('firebase/firestore');
        const docRef = doc(db, 'financialData', uid);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return null;
        const raw = snap.data();
        return { data: raw, revision: Number(raw.revision || 0) };
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, docPath);
      }
    },

    async save(data: AppData, baseRevision: number): Promise<number | null> {
      try {
        const { db } = await startFirebase();
        const { doc, runTransaction } = await import('firebase/firestore');
        const docRef = doc(db, 'financialData', uid);

        const result = await runTransaction(db, async (tx) => {
          const snap = await tx.get(docRef);
          const now = new Date().toISOString();

          if (!snap.exists()) {
            if (baseRevision !== 0) return null;
            const newDoc = {
              userId: uid,
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
            return null; // Concurrency conflict
          }

          const nextRev = baseRevision + 1;
          const updatedDoc = {
            userId: uid,
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
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    },

    async remove(): Promise<void> {
      try {
        const { db } = await startFirebase();
        const { doc, deleteDoc } = await import('firebase/firestore');
        const docRef = doc(db, 'financialData', uid);
        await deleteDoc(docRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
    },
  };
}

const LAST_USER_KEY = 'financial-os:account:last-user';

function rememberUser(user: AccountUser | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Local storage unavailable
  }
}

function lastUser(): AccountUser | null {
  try {
    const text = localStorage.getItem(LAST_USER_KEY);
    return text ? (JSON.parse(text) as AccountUser) : null;
  } catch {
    return null;
  }
}

/**
 * Creates the AuthService implementation using Firebase Auth.
 * Loads Firebase on demand so device-only builds never download it.
 */
export function firebaseAuth(): AuthService {
  return {
    async currentUser() {
      try {
        const { auth } = await startFirebase();
        await auth.authStateReady();
        if (auth.currentUser) {
          const user: AccountUser = {
            id: auth.currentUser.uid,
            email: auth.currentUser.email || '',
          };
          rememberUser(user);
          return user;
        }
      } catch {
        // Offline or connection failure
      }
      return lastUser();
    },

    onSignedOut(callback) {
      let unsubscribe: (() => void) | null = null;
      void startFirebase().then(({ auth }) => {
        void import('firebase/auth').then(({ onAuthStateChanged }) => {
          unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user) callback();
          });
        });
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    },

    async signInWithGoogle() {
      const { auth } = await startFirebase();
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      const user: AccountUser = {
        id: cred.user.uid,
        email: cred.user.email || '',
      };
      rememberUser(user);
      return user;
    },

    async signOut() {
      rememberUser(null);
      const { auth } = await startFirebase();
      const { signOut } = await import('firebase/auth');
      await signOut(auth);
    },

    async deleteAccount() {
      const { auth } = await startFirebase();
      const user = auth.currentUser;
      if (user) {
        const backend = firebaseBackend(user.uid);
        await backend.remove().catch(() => undefined);
        const { deleteUser } = await import('firebase/auth');
        await deleteUser(user);
      }
      rememberUser(null);
    },

    adapterFor(user) {
      return new CloudAdapter(firebaseBackend(user.id), user.id);
    },
  };
}
