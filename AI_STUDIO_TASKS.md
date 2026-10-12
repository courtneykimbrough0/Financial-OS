# Financial OS — Firebase Setup & Production Hardening Tasks

Tracking file for Firebase configuration, hosting, security rules, and App Check setup.

---

### Tasks

- [x] **1. Deploy firestore.rules to database `ai-studio-financialos-de1b8680-2780-4a6a-8754-0c3455a5b5c8` in project `financial-os-505002`**
  - Path enforced: `financialData/{uid}` with strict revision checking (`revision == resource.data.revision + 1`).
  - Linted with `@firebase/eslint-plugin-security-rules`.
  - Deployed via Firebase RPC (`DeployRules`).

- [x] **2. Enable Google Sign-In & Configure Authorized Domains**
  - Provisioned Google OAuth via `ProvisionFirebase` RPC.
  - Client ID configured in `firebase-applet-config.json`.
  - Authorized domains required:
    - `financial-os-505002.firebaseapp.com`
    - `financial-os-505002.web.app`
    - `ais-dev-tqz7tccpwk764w5cepd4c6-14112508718.us-east5.run.app`
    - `ais-pre-tqz7tccpwk764w5cepd4c6-14112508718.us-east5.run.app`
    - `localhost`

- [x] **3. Hosting: Configure Firebase Hosting in `firebase.json`**
  - Configured `firebase.json` with public `dist`, SPA rewrite (`**` -> `/index.html`).
  - Added strict `no-cache` headers for `/sw.js`, `/index.html`, and `/manifest.webmanifest`.
  - Set `authDomain` in `firebase-applet-config.json` to `financial-os-505002.firebaseapp.com`.

- [ ] **4. Restrict the browser API key (Cloud Console)**
  - *Action needed in Google Cloud Console / Firebase Console*:
    1. Navigate to **Google Cloud Console > APIs & Services > Credentials**.
    2. Select the browser API key (`AIzaSyDMC0JoEnxXMbQD07-K2c93FSRFCrHx36w`).
    3. Under **Application restrictions**, select **Web sites / HTTP referrers** and add:
       - `https://financial-os-505002.firebaseapp.com/*`
       - `https://financial-os-505002.web.app/*`
       - `https://ais-dev-tqz7tccpwk764w5cepd4c6-14112508718.us-east5.run.app/*`
       - `https://ais-pre-tqz7tccpwk764w5cepd4c6-14112508718.us-east5.run.app/*`
       - `http://localhost:*/*`
    4. Under **API restrictions**, select **Restrict key** and enable:
       - **Identity Toolkit API**
       - **Token Service API**
       - **Cloud Firestore API**
       - **Firebase Installations API**

- [x] **5. Register App Check with reCAPTCHA Enterprise in `src/state/firebase.ts`**
  - Wired `initializeAppCheck` inside `startFirebase` in `src/state/firebase.ts` using `ReCaptchaEnterpriseProvider`.
  - Reads `recaptchaSiteKey` from `firebase-applet-config.json`.
  - Enforcement left off for initial rollout.
  - *Action needed in Firebase Console*: Register web app in Firebase App Check with your reCAPTCHA Enterprise key ID.

- [ ] **6. Turn on Firestore backups (Cloud Console)**
  - *Action needed in Google Cloud / Firebase Console or gcloud CLI*:
    Run in Cloud Shell or project terminal:
    ```bash
    gcloud firestore backups schedules create \
      --database='ai-studio-financialos-de1b8680-2780-4a6a-8754-0c3455a5b5c8' \
      --recurrence=daily \
      --retention=7d \
      --project='financial-os-505002'
    ```

---

### Verification Pipeline Checklist
Run and pass before each commit:
- `npm run lint` (TypeScript typecheck)
- `npm test` (Unit and component tests via Vitest)
- `npm run test:rules` (Security rules lint check via ESLint)
- `npm run build` (Production Vite and Service Worker build)
- `npm run e2e` (Chromium end-to-end smoke test)
