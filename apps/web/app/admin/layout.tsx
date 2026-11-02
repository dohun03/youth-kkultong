import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminSessionShell } from './admin-session';
import './admin.css';

export const metadata: Metadata = { title: '관리자 | 청년꿀통', robots: { index: false, follow: false } };

/** 관리자 경로를 공통 인증 확인과 메뉴로 감쌈 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminSessionShell>{children}</AdminSessionShell>;
}
