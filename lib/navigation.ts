/** Only return to known application routes. Never allow a scheme, host or login loop. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !/^\/(chart|heming|history|account|sources)([?#]|$)/.test(value)
    || /[\\\u0000-\u001f\u007f]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(value)) return '/chart';
  try {
    const url = new URL(value, 'https://mingli.invalid');
    return url.origin === 'https://mingli.invalid' ? url.pathname + url.search + url.hash : '/chart';
  } catch { return '/chart'; }
}

export function loginPath(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return `/login?next=${encodeURIComponent(safeReturnPath(location.pathname + location.search + location.hash))}`;
}
