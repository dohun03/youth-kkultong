'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { AdminIdentity } from '@youth-kkultong/shared';

/** 관리자 인증 상태와 로그인 화면에서 사용할 동작 */
interface AdminSession {
  login(username: string, password: string): Promise<void>;
  notice: string;
}
const SessionContext = createContext<AdminSession | null>(null);

/** 로그인 화면이 공통 인증 상태를 사용하도록 연결 */
export function useAdminSession(): AdminSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('관리자 공통 화면이 필요합니다.');
  return session;
}

/** 서버가 인증을 거부한 경우와 일시적인 접속 오류를 구분 */
export class AdminAuthError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? '아이디 또는 비밀번호를 확인해 주세요.'
      : status === 400 ? '입력한 아이디와 비밀번호 형식을 확인해 주세요.'
      : status === 429 ? '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.'
        : status === 403 ? '요청을 확인할 수 없습니다. 관리자 페이지를 다시 열어 주세요.'
          : '인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/** 동일 출처로 인증 API 호출 -> 응답 확인 -> 관리자 정보 반환 */
async function requestAuth(action: 'me' | 'login' | 'logout', body?: object, signal?: AbortSignal): Promise<AdminIdentity | null> {
  const response = await fetch(`/api/v1/admin/auth/${action}`, {
    method: action === 'me' ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new AdminAuthError(response.status);
  if (action === 'logout') {
    if (response.status !== 204) throw new Error('로그아웃 응답을 확인하지 못했습니다.');
    return null;
  }
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || !('username' in value) || typeof value.username !== 'string'
    || !('expiresAt' in value) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new Error('인증 응답을 확인하지 못했습니다.');
  }
  return { username: value.username, expiresAt: value.expiresAt };
}

/** 인증 확인 -> 로그인 또는 보호 화면 표시 -> 만료와 로그아웃 시 보호 화면 닫기 */
export function AdminSessionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/admin/login';
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'anonymous' | 'error'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  // 이전 인증 조회가 뒤늦게 도착해 로그인이나 로그아웃 결과를 덮어쓰지 않도록 순서를 구분
  const authVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const version = ++authVersion.current;
    setStatus('checking');
    setIdentity(null);
    // 페이지 이동과 새로고침마다 서버 쿠키를 확인하고, 이전 화면의 응답은 취소
    void requestAuth('me', undefined, controller.signal).then((session) => {
      if (!active || version !== authVersion.current) return;
      setIdentity(session);
      setStatus('authenticated');
      if (isLogin || pathname === '/admin') router.replace('/admin/reviews');
    }).catch((error: unknown) => {
      if (!active || version !== authVersion.current) return;
      if (error instanceof AdminAuthError && error.status === 401) {
        setStatus('anonymous');
        if (!isLogin) {
          setNotice('관리자 로그인이 필요합니다.');
          router.replace('/admin/login');
        }
      } else setStatus('error');
    });
    return () => { active = false; controller.abort(); };
  }, [pathname, isLogin, router, attempt]);

  useEffect(() => {
    // 다른 탭에서 로그아웃하거나 뒤로 가기로 돌아와도 서버 인증을 다시 확인
    const refresh = () => { if (document.visibilityState === 'visible') setAttempt((value) => value + 1); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    if (!identity) return;
    // 서버에서 받은 고정 만료 시각이 되면 관리자 정보를 지우고 로그인으로 이동
    const timeout = setTimeout(() => {
      authVersion.current++;
      setIdentity(null);
      setStatus('anonymous');
      setNotice('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      router.replace('/admin/login');
    }, Math.max(0, Date.parse(identity.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [identity, router]);

  /** 계정 확인과 쿠키 발급이 성공하면 검수 대기 화면으로 이동 */
  async function login(username: string, password: string): Promise<void> {
    const session = await requestAuth('login', { username, password });
    authVersion.current++;
    setIdentity(session);
    setStatus('authenticated');
    setNotice('');
    setLogoutError('');
    router.replace('/admin/reviews');
  }

  /** 삭제 쿠키 응답을 확인한 뒤 관리자 정보를 지우고 로그인 화면으로 이동 */
  async function logout(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError('');
    try {
      await requestAuth('logout', {});
      authVersion.current++;
      setIdentity(null);
      setStatus('anonymous');
      setNotice('로그아웃되었습니다.');
      router.replace('/admin/login');
    } catch {
      setLogoutError('로그아웃을 확인하지 못했습니다. 다시 시도해 주세요.');
      // 응답을 잃었어도 삭제 쿠키가 반영됐을 수 있으므로 안전한 인증 조회로 현재 상태 확인
      setAttempt((value) => value + 1);
    } finally { setLoggingOut(false); }
  }

  const session = { login, notice };
  if (status === 'error') return <main id="main-content" className="admin-page container">
    <h1>관리자 인증 확인</h1><p role="alert">인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
    <button className="retry-button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
  </main>;
  if (status === 'checking' || (isLogin && status === 'authenticated') || (!isLogin && status !== 'authenticated') || pathname === '/admin') {
    return <main id="main-content" className="admin-page container"><p role="status">관리자 인증을 확인하고 있습니다.</p></main>;
  }
  if (isLogin) return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;

  return <SessionContext.Provider value={session}>
    <main id="main-content" className="admin-page container">
      <header className="admin-heading">
        <div><p className="admin-eyebrow">관리자 공간</p><h1>정책 검수 관리</h1></div>
        <div className="admin-account"><span>{identity?.username}님</span>
          <button className="admin-logout" onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? '로그아웃 중…' : '로그아웃'}</button></div>
      </header>
      <nav aria-label="관리자 메뉴" className="admin-nav">
        {[['/admin/reviews', '검수 대기'], ['/admin/history', '처리 이력'], ['/admin/missing', '누락 정책']].map(([href, label]) =>
          <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {logoutError && <p role="alert" className="admin-error">{logoutError}</p>}
      {children}
    </main>
  </SessionContext.Provider>;
}
