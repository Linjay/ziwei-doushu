'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { AccountUser, RememberedAccount } from '@/lib/account';
import { flushAccountSaves } from '@/lib/account-sync';
import { loginPath } from '@/lib/navigation';
import { House, Compass, Users, History, UserRound } from 'lucide-react';

interface AccountContextValue {
  user: AccountUser | null; ready: boolean; error: string;
  refresh: () => Promise<void>; setUser: (user: AccountUser | null) => void;
  logout: (forgetDevice?: boolean) => Promise<void>; loggingOut: boolean;
  rememberedAccounts: RememberedAccount[];
  forgetAccount: (id: string) => Promise<void>;
}
const Context = createContext<AccountContextValue | null>(null);
export function useAccount() {
  const value = useContext(Context);
  if (!value) throw new Error('AccountProvider is required');
  return value;
}
export class AccountRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function accountRequest(url: string, method = 'GET', body?: unknown) {
  let response: Response;
  try { response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); }
  catch { throw new AccountRequestError('网络连接失败，请检查网络后重试。', 0); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountRequestError(data.error?.message || '服务暂时不可用，请稍后重试。', response.status);
  return data;
}
export default function AccountProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<AccountUser | null>(null);
  const [rememberedAccounts,setRememberedAccounts] = useState<RememberedAccount[]>([]);
  const revision = useRef(0);
  const setUser = useCallback((value: AccountUser | null) => { revision.current++; updateUser(value); },[]);
  const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const router = useRouter(); const pathname = usePathname();
  const refresh = useCallback(async () => {
    const started = ++revision.current;
    try {
      let data = await accountRequest('/api/auth/me');
      if (started !== revision.current) return;
      setRememberedAccounts(data.device?.accounts || []);
      if (data.user && !data.device?.accounts?.some((account: RememberedAccount) => account.id === data.user.id)) {
        data = await accountRequest('/api/auth/remember-device','POST',{});
      }
      if (!data.user && data.device?.autoResume) {
        try { data = await accountRequest('/api/auth/device-login','POST',{}); }
        catch (error) { if (!(error instanceof AccountRequestError && error.status === 401)) throw error; data = { user:null }; }
      }
      if (started === revision.current) { updateUser(data.user); setError(''); }
    }
    catch (error) { if (started === revision.current) setError(error instanceof Error ? error.message : '账号加载失败。'); }
    finally { if (started === revision.current) setReady(true); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = async (forgetDevice = false) => {
    revision.current++;
    setBusy(true); setError('');
    try {
      await flushAccountSaves(); const data = await accountRequest('/api/auth/logout', 'POST', { forgetDevice });
      setRememberedAccounts(data.device?.accounts || []);
      if (user) { try { localStorage.removeItem(`ziwei_account_${user.id}_history_v1`); } catch {} }
      if (user) try { Object.keys(sessionStorage).filter(key => key.startsWith(`mingli_draft_${user.id}_`)).forEach(key => sessionStorage.removeItem(key)); } catch {}
      setUser(null); router.push('/login');
    } catch (error) {
      if (error instanceof AccountRequestError && error.status === 401) { setUser(null); router.push('/login'); }
      else setError(error instanceof Error ? error.message : '退出失败，请重试。');
    }
    finally { setBusy(false); }
  };
  const forgetAccount = async (id: string) => {
    const data = await accountRequest('/api/auth/forget-device-account','POST',{userId:id});
    setRememberedAccounts(data.accounts || []);
    if (data.signedOut) { setUser(null); router.push('/login'); }
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    let expandedHeight = window.innerHeight;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const editing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
      if (!editing) expandedHeight = window.innerHeight;
      const keyboard = editing && expandedHeight - height > 120;
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
      document.documentElement.dataset.keyboard = String(keyboard);
    };
    update(); viewport?.addEventListener('resize', update); window.addEventListener('resize', update);
    document.addEventListener('focusin', update); document.addEventListener('focusout', update);
    return () => { viewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); };
  }, []);
  return <Context.Provider value={{ user, ready, error, refresh, setUser, logout, loggingOut: busy, rememberedAccounts, forgetAccount }}>
    <div className="app-frame" data-auth={pathname === '/login'} data-landing={pathname === '/'}>
    <header className="app-header">
      <Link href="/" className="app-brand"><span aria-hidden="true">✦</span> 紫微命盘</Link>
      <nav aria-label="主导航" className="app-nav">
        {([['/', '首页', House], ['/chart', '命盘', Compass], ['/heming', '合盘', Users], ['/history', '历史', History], ['/account', '我的', UserRound]] as const).map(([href, label, Icon]) =>
          <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}><Icon size={21} aria-hidden="true" /><span>{label}</span></Link>)}
      </nav>
      <div className="app-session">{!ready ? <span>正在连接…</span> : user ? <>
        <Link href="/account" className="session-name">{user.profile.displayName}</Link>
        <button type="button" className="text-button" disabled={busy} onClick={() => void logout()}>{busy ? '保存中…' : '退出'}</button>
      </> : <Link href="/login" className="small-button">登录 / 注册</Link>}</div>
    </header>
    {error && <div className="app-message" role="alert">{error} <button className="text-button" onClick={() => void refresh()}>重试</button></div>}
    {children}
    <footer className="app-footer">个人命盘与解读按账号保存 · 传统文化学习工具<br /><Link href="/library">古籍阅读</Link> · <Link href="/privacy">隐私说明</Link> · <Link href="/terms">使用说明</Link></footer>
    </div>
  </Context.Provider>;
}
export function AccountGuard({ children }: { children: ReactNode }) {
  const { user, ready, error } = useAccount(); const router = useRouter(); const pathname = usePathname();
  useEffect(() => { if (ready && !user && !error) router.replace(loginPath(window.location)); }, [ready, user, error, router, pathname]);
  if (!ready || !user) return <main className="account-shell"><div className="account-card" role="status">{error || '正在读取账号…'}</div></main>;
  return <>{children}</>;
}
