/**
 * Firebase accounts: Google sign-in (Firebase Auth) and account storage
 * (Firestore). Loaded only when accounts are turned on, so device-only builds
 * and the tests never download or start Firebase.
 *
 * Each user's whole forecast is one Firestore document at
 * `financialData/{uid}`, holding the same data the app keeps on the device plus
 * a revision number. `firestore.rules` lets each user reach only their own
 * document and accepts a save only when it raises the revision by exactly one,
 * which is what lets the app detect a stale device instead of overwriting newer
 * data.
 */
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { deleteDoc, doc, getDoc, initializeFirestore, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { AppData } from '../domain/types';
import { lastUser, rememberUser, type AccountUser, type AuthService } from './account';
import { CloudAccessError, CloudAdapter, type CloudBackend } from './cloud';

export const COLLECTION = 'financialData';

/** Firestore error codes that mean "refused" rather than "unreachable". */
const REFUSED = new Set(['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'not-found', 'resource-exhausted']);

function classify(err: unknown): never {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (REFUSED.has(code)) throw new CloudAccessError(code);
  throw err instanceof Error ? err : new Error('Account storage unreachable.');
}

/** Firestore storage for one user's forecast, used through `CloudAdapter`. */
export function firebaseBackend(db: Firestore, userId: string): CloudBackend {
  const ref = doc(db, COLLECTION, userId);
  return {
    async fetch() {
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        return { data, revision: Number(data.revision) };
      } catch (err) {
        classify(err);
      }
    },
    async save(data: AppData, baseRevision: number) {
      try {
        return await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const stored = snap.exists() ? Number(snap.data().revision) : 0;
          if (stored !== baseRevision) return null;
          const revision = baseRevision + 1;
          tx.set(ref, {
            userId,
            schemaVersion: 2,
            revision,
            onboardingComplete: Boolean(data.onboardingComplete),
            sources: data.sources,
            records: data.records,
            updatedAt: serverTimestamp(),
          });
          return revision;
        });
      } catch (err) {
        classify(err);
      }
    },
    async remove() {
      try {
        await deleteDoc(ref);
      } catch (err) {
        classify(err);
      }
    },
  };
}

export interface FirebaseSettings extends FirebaseOptions {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
  recaptchaSiteKey?: string;
}

export function startFirebase(settings: FirebaseSettings): { auth: Auth; db: Firestore } {
  const app = initializeApp(settings);
  // App Check proves requests come from this app. It turns on once a
  // reCAPTCHA Enterprise site key is in firebase-applet-config.json;
  // enforcement is switched on separately in the Firebase console.
  if (settings.recaptchaSiteKey && typeof window !== 'undefined') {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(settings.recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
  }
  // Drop undefined fields instead of failing the whole save over one.
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true }, settings.firestoreDatabaseId || '(default)');
  return { auth: getAuth(app), db };
}

const toAccountUser = (u: User): AccountUser => ({ id: u.uid, email: u.email ?? '' });

function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

const CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];
const errorCode = (err: unknown) => (typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '');

/** Sign-in failures in plain language. Returns null when the person simply closed the Google window. */
export function signInMessage(err: unknown): string | null {
  const code = errorCode(err);
  if (CANCELLED.includes(code)) return null;
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in window. Allow pop-ups for Financial OS, then try again.';
  if (code === 'auth/network-request-failed') return 'Financial OS can’t connect right now. Check your connection and try again.';
  if (code === 'auth/unauthorized-domain') return 'Sign-in isn’t set up for this web address yet.';
  return 'Sign-in couldn’t be completed. Try again.';
}

export function firebaseAuthService(settings: FirebaseSettings): AuthService {
  const { auth, db } = startFirebase(settings);
  return {
    async currentUser() {
      try {
        await auth.authStateReady();
      } catch {
        // Offline start-up: open with the account that was last signed in.
        return lastUser();
      }
      if (!auth.currentUser) return null;
      const user = toAccountUser(auth.currentUser);
      rememberUser(user);
      return user;
    },
    onSignedOut(callback) {
      return onAuthStateChanged(auth, (user) => {
        if (!user) callback();
      });
    },
    async signInWithGoogle() {
      try {
        const cred = await signInWithPopup(auth, googleProvider());
        const user = toAccountUser(cred.user);
        rememberUser(user);
        return user;
      } catch (err) {
        const message = signInMessage(err);
        throw Object.assign(new Error(message ?? 'cancelled'), { cancelled: message === null });
      }
    },
    async signOut() {
      rememberUser(null);
      await signOut(auth);
    },
    async deleteAccount() {
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in again, then delete your account.');
      // Firebase deletes an account only right after a fresh sign-in, so confirm
      // first; if the person backs out, nothing has been deleted.
      try {
        await reauthenticateWithPopup(user, googleProvider());
      } catch (err) {
        throw new Error(signInMessage(err) ?? 'Your account wasn’t deleted. Confirm with Google to delete it.');
      }
      try {
        await firebaseBackend(db, user.uid).remove();
      } catch {
        throw new Error('Your account wasn’t deleted because its data couldn’t be removed. Check your connection and try again.');
      }
      await deleteUser(user);
      rememberUser(null);
    },
    adapterFor(user) {
      return new CloudAdapter(firebaseBackend(db, user.id), user.id);
    },
  };
}
