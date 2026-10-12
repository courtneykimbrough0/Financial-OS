# Security Specification: Financial OS Firestore Rules

## 1. Data Invariants
- **Catch-All Denial**: Any unmapped collection or subcollection path is denied to all callers.
- **Strict User Isolation**: Firestore data lives only at `financialData/{uid}`.
- **Strict Ownership**: A user can only read, create, update, or delete the document where `request.auth.uid == uid` and `request.resource.data.userId == uid`.
- **Revision Integrity**:
  - `create` must start with `revision == 1`.
  - `update` must enforce `incoming().revision == existing().revision + 1`.
- **Strict Schema Enforcement**: Only allowed fields (`userId`, `schemaVersion`, `revision`, `onboardingComplete`, `sources`, `records`, `updatedAt`) are accepted.
- **Immutable Fields**: `userId` cannot be changed on update (`incoming().userId == existing().userId`).
- **No Blanket Queries**: `list` queries are disallowed (`allow list: if false`).

## 2. Dirty Dozen Payloads
1. **Unauthenticated Read**: Reading `/financialData/{uid}` without auth token. (Expected: DENIED)
2. **Cross-User Read**: User `alice` reading `/financialData/bob`. (Expected: DENIED)
3. **Unauthenticated Write**: Creating or updating `/financialData/{uid}` without auth. (Expected: DENIED)
4. **Cross-User Write**: User `alice` writing to `/financialData/bob`. (Expected: DENIED)
5. **Collection Listing**: Listing `/financialData`. (Expected: DENIED)
6. **Shadow Field Injection**: Writing ghost fields like `isAdmin: true` into `/financialData/{uid}`. (Expected: DENIED)
7. **Identity Spoofing**: User `alice` creating `/financialData/alice` with `userId: "bob"`. (Expected: DENIED)
8. **Invalid Path Injection (ID Poisoning)**: Accessing path with traversal or excessive size. (Expected: DENIED)
9. **Missing Required Fields**: Writing without `revision`, `sources`, or `records`. (Expected: DENIED)
10. **Type Poisoning**: Setting `revision` to string or `sources` to a non-list. (Expected: DENIED)
11. **Immortal Field Tampering**: Changing `userId` during an update. (Expected: DENIED)
12. **Revision Skipping**: Updating with `revision == existing().revision + 2` or decrementing revision. (Expected: DENIED)
