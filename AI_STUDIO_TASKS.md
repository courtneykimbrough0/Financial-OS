# Firebase setup tasks for AI Studio

The app code for Firebase accounts is done and tested; see the "Accounts (Firebase)" section of README.md. What's left is setup in the Firebase and Google Cloud consoles that can't be done from the code. Work through these in order and check each one off.

Firebase project: `financial-os-505002`. Firestore database: `ai-studio-financialos-de1b8680-2780-4a6a-8754-0c3455a5b5c8`.

## Ground rules for any code change

- Use **npm**. Keep `package-lock.json` committed, and don't add `bun.lock` or another lockfile. Only change `package-lock.json` by running `npm install` with a real npm; every package entry should keep its `resolved` and `integrity` fields, which let `npm ci` verify that each download is the expected file.
- Before committing, run all of these and keep them passing: `npm run lint`, `npm test`, `npm run test:rules` (needs Java), `npm run build` and `npm run e2e`.
- The Firestore data lives at `financialData/{uid}`. If you change that path or the document's fields, update `firestore.rules`, `security_spec.md`, `firebase-blueprint.json` and `src/state/__tests__/firestore.rules.test.ts` in the same change.
- Keep the revision check in `firebaseBackend.save` (a transaction) and in the rules (exactly +1). It's what stops a stale device from overwriting newer data.
- Import Firebase only from `src/state/firebase.ts`, which loads on demand. `account.tsx` and the screens stay free of Firebase so device-only builds don't download it.
- Don't put user details (email, uid, provider data) in error messages or console logs.

## 0. Stop the preview from reloading while someone types

- [ ] Run the preview (financial-os-2.ai.studio) with the environment variable `DISABLE_HMR=true`. vite.config.ts turns live reload off when it's set; without it, the page reloads whenever files change or the preview's connection drops, and whatever was being typed is lost.
- [ ] For testing with real data, prefer a production build (`npm run build && npm start`, or the Cloud Run deploy) over the dev server. It never live-reloads, and new versions wait for the "Update" bar instead of reloading on their own.

## 1. Bring in your pending fixes

- [x] Done. AI Studio's commit "simplify Firestore data model and security rules" is merged into this branch. Its hosting settings and App Check setup are kept; the rest was already covered here (one document per user, no profile document, revision check).

## 2. Deploy the security rules (again)

**Redeploy now.** The rules AI Studio published earlier expect `updatedAt` as a string, but the app now writes the server's timestamp (the rules check it equals the request time). Until this version of `firestore.rules` is live, every save is refused and the app shows "Your account didn't accept this change."

- [x] First deployment to the named database (done by AI Studio).
- [x] Deploy this version: `firestore.rules` deployed to named database `ai-studio-financialos-de1b8680-2780-4a6a-8754-0c3455a5b5c8` (done by AI Studio via `deploy_firebase` and `fax.DeployRules` RPC).
- [x] Checked `(default)` database: Verified that project `financial-os-505002` does not have a `(default)` database (returned `5 NOT_FOUND`); only the named database exists.
- [ ] Confirm by signing in, adding an item, and reloading: the item is still there.

- [ ] **Deploy again before the review rhythm appears in the app.** This version of `firestore.rules` accepts the optional `review` field. The app writes it only once someone chooses a review rhythm, so saves keep working until then, but a rhythm can't be saved to an account until these rules are live.

## 3. Turn on Google sign-in

- [x] Firebase console → Authentication → Sign-in method: enable **Google**. (Done by AI Studio.)
- [x] Authentication → Settings → Authorized domains: add every web address the app will be served from (Cloud Run URL, custom domain). Sign-in shows "Sign-in isn't set up for this web address yet" on any domain that's missing. (Done by AI Studio: financial-os-505002.firebaseapp.com, financial-os-505002.web.app, both ais-…run.app addresses, localhost.)

## 4. Hosting on Cloud Run

The app is hosted on Cloud Run; Firebase provides only sign-in and data. `server.mjs` is the production server: it serves the built app with the right caching, and forwards Firebase's sign-in pages (`/__/auth/*`) through the app's own address so Google sign-in works in Safari and in the installed iPhone app. The app detects the server (it answers `/__/financial-os/config.json`) and signs in through the address it was opened from, so no `authDomain` change is needed.

- [x] Production server (`server.mjs`, started with `npm start`) and `Dockerfile` are in the repo.
- [ ] Deploy each Cloud Run service from the repo's `Dockerfile` (for example `gcloud run deploy SERVICE --source . --region us-east5`). If AI Studio builds the container itself, make it run `npm ci && npm run build` and start with `npm start`. Never run the Vite dev server (`npm run dev`) in production.
- [ ] Check each deployed address: `https://<address>/__/financial-os/config.json` shows `{"authProxy":true}`. If it shows the app's page instead, the service isn't running `server.mjs`.
- [ ] Google Cloud console → APIs & Services → Credentials → OAuth 2.0 Client IDs → the Web client (auto created by Google Service):
  - under **Authorized JavaScript origins**, add each Cloud Run address (for example `https://ais-pre-tqz7tccpwk764w5cepd4c6-14112508718.us-east5.run.app`);
  - under **Authorized redirect URIs**, add each address followed by `/__/auth/handler`.
  Without this, Google shows "redirect_uri_mismatch" during sign-in.
- [x] Firebase console → Authentication → Settings → Authorized domains lists both Cloud Run addresses (done in step 3).

Firebase Hosting is optional and not used. `firebase.json` keeps a `hosting` section in case it's ever wanted.

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
