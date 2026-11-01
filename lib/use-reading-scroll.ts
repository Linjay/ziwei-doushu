'use client';
import { useLayoutEffect, useRef, useState } from 'react';

/** Follow a live answer only while its reader is at the end; keep positions per topic. */
export function useReadingScroll(key: string, revision: unknown, generating: boolean, storageKey?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const following = useRef(false); const requested = useRef<string | null>(null);
  const [hasNew, setHasNew] = useState(false);
  useLayoutEffect(() => {
    following.current = requested.current === key;
    requested.current = null; setHasNew(false);
    let saved = positions.current.get(key) || 0;
    if (storageKey && !positions.current.has(key)) try { const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}')[key]; if (Number.isFinite(value) && value >= 0) saved = value; } catch {}
    if (ref.current) ref.current.scrollTop = saved;
  }, [key, storageKey]);
  useLayoutEffect(() => {
    if (following.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    else if (generating) setHasNew(true);
  }, [revision, generating, key]);
  const onScroll = () => {
    const element = ref.current; if (!element) return;
    positions.current.set(key, element.scrollTop);
    if (storageKey) try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); saved[key] = element.scrollTop; sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (following.current) setHasNew(false);
  };
  const startFollowing = (target = key) => { following.current = true; requested.current = target; setHasNew(false); };
  const jump = () => { startFollowing(); if (ref.current) { ref.current.scrollTop = ref.current.scrollHeight; positions.current.set(key, ref.current.scrollTop); } };
  return { ref, onScroll, hasNew, startFollowing, jump };
}
