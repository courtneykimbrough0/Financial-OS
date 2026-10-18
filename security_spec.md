# Security Specification: Financial OS Firestore Rules

These rules protect the current (legacy) Firebase version of Financial OS. Supabase will replace Firestore (AGENTS.md section C1); until then, keep these guarantees and their tests.

`firestore.rules` is tested against the Firestore emulator by
`src/state/__tests__/firestore.rules.test.ts` (`npm run test:rules`). Every
statement below is one or more of those tests.

## Data invariants
- **One document per user.** A user's forecast lives at `financialData/{uid}`. Every other path is denied.
- **Owner only.** Only the signed-in user whose uid matches the document ID can read, create, update or delete it. Signed-out callers get nothing.
- **No listing.** Nobody can list or query the collection, including their own document; the app reads by ID only.
- **Exact shape.** A write must contain exactly `userId`, `schemaVersion`, `revision`, `onboardingComplete`, `sources`, `records` and `updatedAt`, with the right types, plus optionally `review` (the review rhythm: `cadence` one of off, weekly, payday or monthly; `handledOn` a `YYYY-MM-DD` date or null; `outcome` completed, skipped or null; nothing else). Extra fields are rejected.
- **Identity.** `userId` must equal the document ID (and therefore the caller's uid).
- **Revision.** The first save must be revision 1; every update must be exactly the stored revision + 1. This makes a stale device's save fail instead of overwriting newer data.
- **Server time.** `updatedAt` must be the server's time for the request.
- **Size.** At most 2,000 recurring items and 20,000 records (Firestore's 1 MiB document limit is reached long before that in practice).

## Denied payloads (each is a test)
1. Signed-out read or write.
2. Reading, writing or deleting another user's document.
3. Listing the collection.
4. A document whose `userId` isn't the caller.
5. An extra field (for example `isAdmin: true`).
6. A missing field, or a field of the wrong type (for example `revision: "2"`).
7. A first save that isn't revision 1.
8. An update that skips a revision, repeats one, or goes backwards.
9. An `updatedAt` set by the client instead of the server.
10. Writing to any other collection.
11. A `review` that isn't exactly `cadence`, `handledOn` and `outcome` with allowed values.

**Accounts (where money is received, held and spent).** Never written to Firestore: while `ACCOUNTS_IN_SIGNED_IN_SAVES` is false, account saves leave out `accounts` and every item's `accountId`, so the rules above (a fixed set of top-level fields) are unchanged and no save is refused.
