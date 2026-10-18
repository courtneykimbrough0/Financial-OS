/**
 * Whether the review rhythm can be chosen, and is saved, while signed in.
 * Keep false until the current `firestore.rules` (which accept the optional
 * `review` field) are deployed to the live database and checked: under the
 * older rules a save that includes the field is refused, and a refused save
 * pauses every later save. Until then the rhythm is device-only: the
 * Settings control and dashboard review are hidden when signed in, and
 * account saves leave out a rhythm that came from this device (moved in, or
 * from a restored backup) while keeping one the account already has
 * (`CloudAdapter.save`). Without an account it always works.
 */
export const REVIEW_RHYTHM_IN_ACCOUNTS = false;

/**
 * Whether accounts (where money is received, held and spent) are available,
 * and saved, while signed in with Firebase. Keep false: the live
 * `firestore.rules` accept only the fields listed there, and Firebase is
 * legacy (AGENTS.md section C1), so the rules won't change for this. Accounts
 * work with device storage and in backups; signed in, the Accounts section and
 * account choices are hidden and `CloudAdapter.save` leaves accounts and item
 * assignments out, so no save is refused. They arrive for accounts with the
 * Supabase migration (roadmap, accounts phase AC-S).
 */
export const ACCOUNTS_IN_SIGNED_IN_SAVES = false;
