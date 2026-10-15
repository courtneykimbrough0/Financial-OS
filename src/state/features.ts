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
