'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { AdminAuthError, useAdminSession } from '../admin-session';

/** 로그인 입력 -> 인증 API 확인 -> 공통 인증 화면에서 검수 대기로 이동 */
export default function AdminLoginPage() {
  const { login, notice } = useAdminSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  /** 비밀번호 원문을 그대로 보내고 응답 후 입력값을 지움 */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    try { await login(username, password); }
    catch (error) {
      setError(error instanceof AdminAuthError ? error.message : '로그인 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
    } finally { setPassword(''); inFlight.current = false; setSubmitting(false); }
  }

  return <main id="main-content" tabIndex={-1} className="admin-login container">
    <section className="admin-login-card" aria-labelledby="admin-login-title">
      <p className="admin-eyebrow">청년꿀통 관리자</p>
      <h1 id="admin-login-title">관리자 로그인</h1>
      <p className="admin-description">정책 검수와 관리를 위해 로그인해 주세요.</p>
      {notice && <p role="status" className="admin-notice">{notice}</p>}
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="admin-username">아이디</label>
        <input id="admin-username" name="username" autoComplete="username" required maxLength={64}
          value={username} onChange={(event) => setUsername(event.target.value)} disabled={submitting} />
        <label htmlFor="admin-password">비밀번호</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={256}
          value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting}
          aria-describedby={error ? 'admin-login-error' : undefined} />
        {error && <p id="admin-login-error" role="alert" className="admin-error">{error}</p>}
        <button className="admin-submit" type="submit" disabled={submitting}>{submitting ? '로그인 중…' : '로그인'}</button>
      </form>
      <Link className="admin-public-link" href="/policies">정책 둘러보기로 돌아가기</Link>
    </section>
  </main>;
}
