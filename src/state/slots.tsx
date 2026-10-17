import { createContext, useContext, type ComponentType } from 'react';

/**
 * Account controls supplied by the storage in use, for storage whose accounts
 * aren't the Firebase ones in `account.tsx` (the development Supabase build).
 * Null in every other build, where Settings and setup show their usual
 * controls.
 */
export interface AccountSlot {
  /** The Settings account card. */
  Card: ComponentType;
  /** One line on the setup welcome screen. */
  Line: ComponentType;
  /** Rendered inside the store, over every screen: what happens when the session ends. */
  Guard: ComponentType;
  /** How Settings describes where the data is kept. */
  dataNote: string;
}

export const AccountSlotContext = createContext<AccountSlot | null>(null);
export const useAccountSlot = () => useContext(AccountSlotContext);
