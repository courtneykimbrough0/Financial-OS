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
