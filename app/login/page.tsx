'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { accountRequest, useAccount } from '@/components/AccountProvider';
import { safeReturnPath } from '@/lib/navigation';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { user, setUser, ready, rememberedAccounts, forgetAccount } = useAccount(); const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const destination = () => {
    return safeReturnPath(new URLSearchParams(window.location.search).get('next'));
  };
  useEffect(() => { if (ready && user) router.replace(destination()); }, [ready, user, router]);
  const enter = async (endpoint: string, body: object = {}) => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try { const data = await accountRequest(endpoint,'POST',body); setUser(data.user); router.replace(destination()); }
    catch (error) { setError(error instanceof Error ? error.message : '暂时无法登录。'); }
    finally { setBusy(false); }
  };
  const forget = async (id: string) => {
    setBusy(true); setError('');
    try { await forgetAccount(id); }
    catch (error) { setError(error instanceof Error ? error.message : '暂时无法移除。'); }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    if (mode === 'register' && form.get('password') !== form.get('confirmPassword')) { setError('两次输入的密码不一致。'); setBusy(false); return; }
    try {
      const data = await accountRequest(`/api/auth/${mode}`, 'POST', { username: form.get('username'), password: form.get('password'), displayName: form.get('displayName') });
      setUser(data.user); router.replace(destination());
    } catch (error) { setError(error instanceof Error ? error.message : '暂时无法登录。'); }
    finally { setBusy(false); }
  };
  return <main className="account-shell auth-shell">
    <div className="auth-intro"><span className="eyebrow">YOUR PERSONAL CHART</span><h1>留一份属于你的命盘</h1><p>起盘、解读、回看。登录后，你的档案和每一次解读都会保存到账号，在手机和电脑间继续查看。</p></div>
    <section className="account-card auth-card" aria-label="账号登录注册">
      {!ready && <p role="status" className="muted">正在恢复这台设备的账号…</p>}
      {ready && !user && <>
        {!!rememberedAccounts.length && <section className="remembered-accounts" aria-label="这台设备使用过的账号"><h2>继续使用</h2><p className="muted">选择此浏览器保存过的账号，无需输入密码。</p><ul>{rememberedAccounts.map(account => <li key={account.id}><button type="button" className="remembered-login" onClick={() => void enter('/api/auth/device-login',{userId:account.id})} disabled={busy}><strong>{account.displayName}</strong><span>@{account.username}</span></button><button type="button" className="text-button" aria-label={`移除此设备上的 ${account.username}`} disabled={busy} onClick={() => void forget(account.id)}>移除</button></li>)}</ul></section>}
        <section className="quick-registration" aria-label="快速体验"><h2>{rememberedAccounts.length ? '使用新账号' : '直接开始体验'}</h2><p className="muted">自动生成 guest_ 开头的英文账号，命盘和解读会保存到该账号。</p><button type="button" className="btn-primary form-submit" disabled={busy} onClick={() => void enter('/api/auth/quick-register')}>{busy ? '正在处理…' : '快速注册并体验'}</button><p className="muted quick-password-note">初始密码为 <strong>12345678</strong>，可在“我的 → 账号安全”修改。本浏览器会记住账号，下次自动登录。</p></section>
      </>}
      <div className="auth-method-divider">使用账号密码</div>
      <div className="segmented" role="group" aria-label="登录方式">
        <button aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>登录</button>
        <button aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>注册账号</button>
      </div>
      <h2>{mode === 'login' ? '欢迎回来' : '创建你的账号'}</h2>
      <form onSubmit={submit} className="account-form">
        {mode === 'register' && <label>昵称<input name="displayName" autoComplete="nickname" maxLength={40} placeholder="如何称呼你" /></label>}
        <label>账号<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} required placeholder="3–32 位字母、数字或下划线" /></label>
        <label>密码<span className="password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} maxLength={128} required placeholder={mode === 'register' ? '至少 10 个字符' : '输入你的密码'} /><button type="button" className="icon-button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button></span></label>
        {mode === 'register' && <label>确认密码<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required placeholder="再次输入密码" /></label>}
        <button className="btn-primary form-submit" type="submit" disabled={busy || !ready}>{busy ? '正在处理…' : mode === 'login' ? '登录并查看命盘' : '注册并开始排盘'}</button>
      </form>
      {error && <p role="alert" className="form-error">{error}</p>}
      <p className="muted form-note">请妥善保存账号和密码。个人档案及历史仅对本人登录账号可见。</p>
      <p className="muted form-note">使用前请阅读<a href="/privacy">隐私说明</a>与<a href="/terms">使用说明</a>。</p>
    </section>
  </main>;
}
