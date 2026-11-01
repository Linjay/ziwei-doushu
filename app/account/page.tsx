'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AccountGuard, accountRequest, useAccount } from '@/components/AccountProvider';
import { useChartHistory } from '@/lib/use-chart-history';
import { beijingDate, type PersonalProfile } from '@/lib/account';
import { insightMessages } from '@/lib/insight-topics';
import ChartHistory from '@/components/ChartHistory';
import { ChevronRight } from 'lucide-react';

export default function AccountPage() { return <AccountGuard><AccountContent /></AccountGuard>; }
function AccountContent() {
  const { user, setUser, logout, loggingOut } = useAccount();
  const [section, setSection] = useState<'home' | 'profile' | 'security' | 'backup'>('home');
  const [profile, setProfile] = useState<PersonalProfile>(user!.profile);
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState(''); const [passwordError, setPasswordError] = useState(''); const [passwordBusy, setPasswordBusy] = useState(false);
  const store = useChartHistory(); const { history, ready } = store;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice(''); setError('');
    try { const data = await accountRequest('/api/account', 'PATCH', profile); setUser(data.user); setNotice('个人档案已保存。'); }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败。'); }
    finally { setBusy(false); }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPasswordBusy(true); setPasswordNotice(''); setPasswordError('');
    const element = event.currentTarget; const form = new FormData(element);
    try {
      if (form.get('newPassword') !== form.get('confirmPassword')) throw new Error('两次输入的新密码不一致。');
      const data = await accountRequest('/api/account', 'POST', { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') });
      setUser(data.user); element.reset(); setPasswordNotice('密码已更新，其他设备的登录和免密记录已失效，本浏览器仍可继续使用。');
    } catch (error) { setPasswordError(error instanceof Error ? error.message : '修改失败。'); }
    finally { setPasswordBusy(false); }
  };
  const field = (key: keyof PersonalProfile, value: string) => setProfile(previous => ({ ...previous, [key]: value }));
  return <main className="account-shell profile-page">
    {section !== 'home' && <button type="button" className="small-button profile-back" onClick={() => setSection('home')}>返回我的</button>}
    <div className="page-heading"><div><span className="eyebrow">PERSONAL PROFILE</span><h1>我的档案</h1><p className="muted">@{user!.username} · 加入于 {new Date(user!.createdAt).toLocaleDateString('zh-CN')}</p></div><Link href="/chart?new=1" className="btn-primary">新建命盘</Link></div>
    {user!.usesInitialPassword && <p className="guest-account-note" role="status">你的快速账号为 <strong>{user!.username}</strong>，初始密码 <strong>12345678</strong>。跨设备可使用账号和密码登录。<button type="button" className="text-button" onClick={() => setSection('security')}>修改初始密码</button></p>}
    {section === 'home' && <><div className="account-stats"><div><strong>{ready ? history.records.length : '—'}</strong><span>单盘与合盘记录</span></div><div><strong>{ready ? history.records.reduce((count, record) => count + insightMessages(record.insight).filter(message => message.role === 'assistant' && message.content).length, 0) : '—'}</strong><span>AI 解读记录</span></div><Link href="/history">查看全部历史 →</Link></div>
    <div className="profile-menu">{([['profile', '编辑个人档案'], ['security', '账号安全'], ['backup', '备份与恢复']] as const).map(([key, label]) => <button type="button" key={key} onClick={() => setSection(key)}>{label}<ChevronRight size={20} aria-hidden="true" /></button>)}<Link href="/library">古籍阅读<ChevronRight size={20} aria-hidden="true" /></Link><Link href="/privacy">隐私与使用说明<ChevronRight size={20} aria-hidden="true" /></Link></div></>}
    {section === 'backup' && <section className="account-card"><h2>备份与恢复</h2><p className="muted">导出完整命盘、合盘和所有主题。备份含私人出生资料，请妥善保管。</p><ChartHistory compact history={history} storageError={store.storageError} syncState={store.syncState} onRetry={store.retrySync} onSelect={() => {}} onNew={() => {}} onExport={store.exportBackup} onImport={store.importBackup} /></section>}
    <div className="profile-layout">
      {section === 'profile' && <section className="account-card"><h2>个人资料</h2><p className="muted">出生日期和时间可用于下次排盘预填；出生地请在排盘时确认。</p>
        <form onSubmit={save} className="account-form">
          <label>昵称<input value={profile.displayName} onChange={event => field('displayName', event.target.value)} required maxLength={40} autoComplete="nickname" /></label>
          <div className="form-columns"><label>出生日期<input type="date" value={profile.birthday} onChange={event => field('birthday', event.target.value)} min="1900-01-01" max={beijingDate()} /></label><label>出生时间（可选）<input type="time" value={profile.birthTime} onChange={event => field('birthTime', event.target.value)} /></label></div>
          <div className="form-columns"><label>性别<select value={profile.gender} onChange={event => field('gender', event.target.value)}><option value="">暂不填写</option><option value="male">男</option><option value="female">女</option></select></label><label>城市（可选）<input value={profile.city} onChange={event => field('city', event.target.value)} maxLength={80} placeholder="如：杭州" /></label></div>
          <label>个人备注<textarea value={profile.bio} onChange={event => field('bio', event.target.value)} maxLength={300} rows={3} placeholder="记录你希望留意的主题…" /></label>
          {notice && <p role="status" className="form-success">{notice}</p>}{error && <p role="alert" className="form-error">{error}</p>}
          <button type="submit" className="btn-primary form-submit" disabled={busy}>{busy ? '保存中…' : '保存档案'}</button>
        </form>
      </section>}
      {section === 'security' && <section className="account-card"><h2>账号安全</h2><p className="muted">修改密码后，其他设备需要重新登录。</p><form onSubmit={changePassword} className="account-form">
        <label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>新密码<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="至少 10 个字符" /></label>
        <label>确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></label>
        {passwordNotice && <p role="status" className="form-success">{passwordNotice}</p>}{passwordError && <p role="alert" className="form-error">{passwordError}</p>}
        <button type="submit" className="small-button" disabled={passwordBusy}>{passwordBusy ? '更新中…' : '更新密码'}</button>
      </form><div className="device-account-actions"><p className="muted">本浏览器会记住登录过的账号。退出后暂停自动登录，仍可在登录页一键选择账号。</p><button type="button" className="small-button" onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? '正在保存并退出…' : '退出当前账号'}</button><button type="button" className="small-button danger" onClick={() => void logout(true)} disabled={loggingOut}>退出并忘记此设备</button></div></section>}
    </div>
  </main>;
}
