# Firebase setup tasks for AI Studio

The app code for Firebase accounts is done and tested; see the "Accounts (Firebase)" section of README.md. What's left is setup in the Firebase and Google Cloud consoles that can't be done from the code. Work through these in order and check each one off.

Firebase project: `financial-os-505002`. Firestore database: `ai-studio-financialos-de1b8680-2780-4a6a-8754-0c3455a5b5c8`.

## Ground rules for any code change

- Use **npm**. Keep `package-lock.json` committed, and don't add `bun.lock` or another lockfile.
- Before committing, run all of these and keep them passing: `npm run lint`, `npm test`, `npm run test:rules` (needs Java), `npm run build` and `npm run e2e`.
- The Firestore data lives at `financialData/{uid}`. If you change that path or the document's fields, update `firestore.rules`, `security_spec.md`, `firebase-blueprint.json` and `src/state/__tests__/firestore.rules.test.ts` in the same change.
- Keep the revision check in `firebaseBackend.save` (a transaction) and in the rules (exactly +1). It's what stops a stale device from overwriting newer data.
- Import Firebase only from `src/state/firebase.ts`, which loads on demand. `account.tsx` and the screens stay free of Firebase so device-only builds don't download it.
- Don't put user details (email, uid, provider data) in error messages or console logs.

## 1. Bring in your pending fixes

- [x] Done. AI Studio's commit "simplify Firestore data model and security rules" is merged into this branch. Its hosting settings and App Check setup are kept; the rest was already covered here (one document per user, no profile document, revision check).

## 2. Deploy the security rules (again)

**Redeploy now.** The rules AI Studio published earlier expect `updatedAt` as a string, but the app now writes the server's timestamp (the rules check it equals the request time). Until this version of `firestore.rules` is live, every save is refused and the app shows "Your account didn't accept this change."

- [x] First deployment to the named database (done by AI Studio).
- [x] Deploy this version: `firestore.rules` deployed to named database `ai-studio-financialos-de1b8680-2780-4a6a-8754-0c3455a5b5c8` (done by AI Studio via `deploy_firebase` and `fax.DeployRules` RPC).
- [x] Checked `(default)` database: Verified that project `financial-os-505002` does not have a `(default)` database (returned `5 NOT_FOUND`); only the named database exists.
- [ ] Confirm by signing in, adding an item, and reloading: the item is still there.

## 3. Turn on Google sign-in

- [x] Firebase console → Authentication → Sign-in method: enable **Google**. (Done by AI Studio.)
- [x] Authentication → Settings → Authorized domains: add every web address the app will be served from (Cloud Run URL, custom domain). Sign-in shows "Sign-in isn't set up for this web address yet" on any domain that's missing. (Done by AI Studio: financial-os-505002.firebaseapp.com, financial-os-505002.web.app, both ais-…run.app addresses, localhost.)

## 4. Hosting

**Recommended: Firebase Hosting.** This is a static app with no server code. Firebase Hosting serves it from a CDN, and because the app is then on the same domain as Firebase's sign-in pages, Google sign-in works in Safari and in the installed iPhone app.

- [x] Add a `hosting` section to `firebase.json`: `"public": "dist"`, a rewrite of `**` to `/index.html`, and `Cache-Control: no-cache` headers for `/sw.js`, `/index.html` and `/manifest.webmanifest`.
- [ ] Deploy: `npm ci && npm run build && firebase deploy --only hosting`.
- [x] Set `authDomain` in `firebase-applet-config.json` to the Hosting domain. It's `financial-os-505002.firebaseapp.com`, so test sign-in there: on the `run.app` addresses, Google sign-in may fail in Safari and in the installed iPhone app.

**If you stay on Cloud Run:**

- [ ] Serve the built files in `dist/` with a small static server listening on `$PORT`. Never run the Vite dev server (`npm run dev`) in production.
- [ ] Send `Cache-Control: no-cache` for `sw.js`, `index.html` and `manifest.webmanifest`, and route every unknown path to `index.html`.
- [ ] Forward `/__/auth/*` to `https://financial-os-505002.firebaseapp.com/__/auth/*`, and set `authDomain` in `firebase-applet-config.json` to the Cloud Run domain. Without this, Safari blocks Google sign-in.

## 5. Test sign-in on a real iPhone

- [ ] Open the deployed app in Safari, choose Share → Add to Home Screen, open it from the home screen, and sign in with Google.
- [ ] Close the app completely and reopen it: you're still signed in and your data is there.
- [ ] Turn on airplane mode, reopen the app, and add an item. Turn airplane mode off: the change saves without a reload.

If the Google window doesn't return to the installed app, switch `signInWithPopup` and `reauthenticateWithPopup` in `src/state/firebase.ts` to `signInWithRedirect` and `reauthenticateWithRedirect`, with `getRedirectResult` on start-up. This needs step 4's same-domain `authDomain`.

## 6. Lock down the project

- [ ] Google Cloud console → APIs & Services → Credentials → the Browser key: under Application restrictions, allow only the app's domains (HTTP referrers). Under API restrictions, allow only Identity Toolkit API, Token Service API, Cloud Firestore API and Firebase Installations API.
- [ ] Firebase console → App Check: register the web app with reCAPTCHA Enterprise, then put the site key in `recaptchaSiteKey` in `firebase-applet-config.json`. The code in `startFirebase` already turns App Check on once the key is there. Watch the App Check metrics for a few days, then turn on enforcement for Firestore and Authentication.
- [ ] Turn on Firestore backups (point-in-time recovery or scheduled backups) for the database.

## 7. Before inviting testers

- [ ] Publish a short privacy policy: what's stored (the user's forecast and their Google email), where (Firebase, the database's region), and how to delete it (Settings → Delete account).
- [ ] Optional: add email and password sign-in as a second option for people who don't want to use Google. Add it to `AuthService` in `src/state/account.tsx` and implement it in `src/state/firebase.ts`; `SignIn.tsx` renders the options.
