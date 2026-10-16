import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '청년꿀통 | 청년 정책 모아보기',
  description: '나에게 필요한 청년 정책과 지원 정보를 한곳에서 확인하세요.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">
          본문으로 건너뛰기
        </a>
        <header className="site-header">
          <div className="container header-content">
            <Link className="brand" href="/policies">
              <span className="brand-mark" aria-hidden="true" />
              청년꿀통
            </Link>
            <span className="header-description">청년 정책 모아보기</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
