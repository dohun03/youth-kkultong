import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '청년꿀통',
  description: '청년을 위한 정책 정보를 한곳에서 확인하세요.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): React.ReactElement {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
