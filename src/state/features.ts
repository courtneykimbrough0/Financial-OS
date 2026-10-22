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
 * Whether possible income (see `IncomeCertainty`) is available, and saved,
 * while signed in with Firebase. Keep false (decision D8): Firebase is legacy
 * (AGENTS.md section C1). The live `firestore.rules` would accept the field,
 * since items aren't checked field by field, but an older copy of the app
 * still open on another device doesn't know it and would count possible
 * income in cash flow and the running total. Leaving the mark out instead
 * would do the same here, so signed in with Firebase the choice is hidden and
 * `CloudAdapter.save` refuses a plan with possible income (nothing is saved
 * or lost) instead of dropping it. Device storage and Supabase keep it.
 */
export const INCOME_CERTAINTY_IN_SIGNED_IN_SAVES = false;

/**
 * Whether hourly and tipped income detail (an income's type and wage, and
 * logged shifts; see `WorkEntry`) is available, and saved, while signed in
 * with Firebase. Keep false (decision D8): the live `firestore.rules` refuse
 * a document with a field they don't list, such as `workEntries`, and
 * Firebase is legacy (AGENTS.md section C1). Leaving the detail out would
 * silently lose it, so signed in with Firebase the choices are hidden and
 * `CloudAdapter.save` refuses a plan that has any (nothing is saved or lost).
 * The cash tips a shift records are ordinary income records and are kept
 * either way. Device storage and Supabase keep all of it.
 */
export const INCOME_DETAIL_IN_SIGNED_IN_SAVES = false;
