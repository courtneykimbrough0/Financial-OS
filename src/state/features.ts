/**
 * Whether the review rhythm can be chosen, and is saved, while signed in.
 * Keep false until the current `firestore.rules` (which accept the optional
 * `review` field) are deployed to the live database and checked: under the
 * older rules a save that includes the field is refused, and a refused save
 * pauses every later save. Until then the rhythm is device-only: the
 * Settings control is hidden when signed in, and account saves leave the
 * field out (`CloudAdapter.save`). Without an account it always works.
 */
export const REVIEW_RHYTHM_IN_ACCOUNTS = false;
