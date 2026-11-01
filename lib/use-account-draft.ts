'use client';
import { useEffect, useState } from 'react';
import { useAccount } from '@/components/AccountProvider';

/** Session-only drafts are scoped to the signed-in account and cleared on logout. */
export function useAccountDraft<T>(name: string, initial: T, validate: (value: unknown) => T) {
  const { user } = useAccount(); const key = user ? `mingli_draft_${user.id}_${name}` : '';
  const [value, setValue] = useState<T>(initial); const [loaded, setLoaded] = useState('');
  useEffect(() => {
    try { setValue(validate(JSON.parse(sessionStorage.getItem(key) || 'null'))); } catch { setValue(validate(null)); }
    setLoaded(key);
  }, [key, validate]);
  useEffect(() => { if (key && loaded === key) try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, loaded, value]);
  return [value, setValue] as const;
}
