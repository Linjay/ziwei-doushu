import { Fragment } from 'react';
import { safeReturnPath } from '@/lib/navigation';

/** A deliberately small renderer: only server-owned reference links become anchors. */
export function AIInline({ text }: { text: string }) {
  return <>{text.split(/(\[[^\]\n]+\]\(\/sources\?ref=[A-Za-z0-9%:_-]+\))/g).map((part, i) => {
    const link = /^\[([^\]\n]+)\]\((\/sources\?ref=[A-Za-z0-9%:_-]+)\)$/.exec(part);
    return link ? <a key={i} href={link[2]} className="ai-reference" onClick={event => {
      const target = new URL(link[2], window.location.origin);
      target.searchParams.set('returnTo', safeReturnPath(location.pathname + location.search + location.hash));
      event.currentTarget.href = target.pathname + target.search;
    }}>{link[1]}</a> : <Fragment key={i}>{part}</Fragment>;
  })}</>;
}
