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

/**
 * Whether income detail (an income's type and wage, logged shifts, and
 * freelance clients and jobs; see `WorkEntry`, `FreelanceJob`) is available, and saved, while signed in
 * with Firebase. Keep false (decision D8): the live `firestore.rules` refuse
 * a document with a field they don't list, such as `workEntries` or `jobs`, and
 * Firebase is legacy (AGENTS.md section C1). Leaving the detail out would
 * silently lose it, so signed in with Firebase the choices are hidden and
 * `CloudAdapter.save` refuses a plan that has any (nothing is saved or lost).
 * The cash tips a shift records and a job's payment are ordinary income
 * records and are kept either way. Device storage and Supabase keep all of it.
 */
export const INCOME_DETAIL_IN_SIGNED_IN_SAVES = false;
