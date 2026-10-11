# Security Specification: Financial OS Firestore Rules

## 1. Data Invariants
- **Catch-All Denial**: Any unmapped collection or subcollection path is denied to all callers.
- **Strict Ownership**: A user can only read, create, update, or delete documents where `userId == request.auth.uid`.
- **Master Gate Invariant**: Subcollection `/users/{userId}/data/{docId}` requires the parent `/users/{userId}` to exist and belong to the authenticated caller.
- **Immutable Fields**: `id` and `userId` cannot be changed after creation.
- **Strict Concurrency Control**: Updates must preserve data integrity; revisions cannot be arbitrarily decremented or bypassed.
- **Strict Key Validation**: Creations and updates allow only declared attributes (`sources`, `records`, `revision`, `schemaVersion`, `onboardingComplete`, `userId`, `updatedAt`). Ghost/shadow fields are rejected.
- **No Blanket Reads**: Client list queries must strictly enforce equality checks against `request.auth.uid`.

## 2. The Dirty Dozen Payloads
1. **Unauthenticated Read**: Attempting to read `/users/{userId}` without a valid auth token. (Expected: DENIED)
2. **Cross-User Profile Read**: User `alice` reading `/users/bob`. (Expected: DENIED)
3. **Cross-User Data Read**: User `alice` reading `/users/bob/data/current`. (Expected: DENIED)
4. **Unauthenticated Write**: Attempting to write to `/users/{userId}/data/current` without being signed in. (Expected: DENIED)
5. **Cross-User Data Write**: User `alice` attempting to write to `/users/bob/data/current`. (Expected: DENIED)
6. **Shadow Field Injection**: Attempting to inject `isAdmin: true` into `/users/{userId}` or `/users/{userId}/data/current`. (Expected: DENIED)
7. **Identity Spoofing**: User `alice` creating `/users/alice/data/current` with `userId: "bob"`. (Expected: DENIED)
8. **Invalid Path Injection (ID Poisoning)**: Writing with path `userId` exceeding 128 characters or containing path traversal characters like `../`. (Expected: DENIED)
9. **Missing Required Fields**: Attempting to save financial data without `revision` or `sources`. (Expected: DENIED)
10. **Type Poisoning**: Attempting to set `revision` to `"not-a-number"` or `sources` to a string instead of a list. (Expected: DENIED)
11. **Immortal Field Tampering**: Attempting to change `userId` during an update. (Expected: DENIED)
12. **Master Gate Violation**: Attempting to create `/users/{userId}/data/current` when `/users/{userId}` parent document does not exist. (Expected: DENIED)
