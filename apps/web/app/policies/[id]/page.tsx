'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PolicyDetail } from '@youth-kkultong/shared';
import { statusLabels } from '../policy-labels';

/** 상세 조회의 대기·없는 정책·통신 오류·정상 응답을 구분한다. */
type DetailState = { status: 'loading' } | { status: 'missing' } | { status: 'error' }
  | { status: 'success'; data: PolicyDetail };

/** 원문 줄바꿈을 보존하고 누락된 항목만 확인 안내로 대체한다. */
function displayText(value: string | null): string {
  return value?.trim() ? value : '공식 신청처에서 확인해 주세요.';
}

/** API의 검증에 더해 화면에서도 절대 HTTP(S) 링크만 새 탭에 연결한다. */
function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && (url.protocol === 'https:' || url.protocol === 'http:');
  } catch { return false; }
}

/** 선택한 정책의 원문 지원·설명·자격·기간·공식 링크를 표시한다. */
export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    /** 개인 조건 없이 정책 ID만 조회하며 오류 응답 원문을 화면에 노출하지 않는다. */
    async function loadDetail(): Promise<void> {
      setState({ status: 'loading' });
      try {
        const response = await fetch(`/api/v1/policies/${encodeURIComponent(id)}`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 404 || response.status === 400) {
          if (active) setState({ status: 'missing' });
          return;
        }
        if (!response.ok) throw new Error('상세 조회 실패');
        const data: PolicyDetail = await response.json();
        if (active) setState({ status: 'success', data });
      } catch {
        if (active) setState({ status: 'error' });
      } finally { clearTimeout(timeout); }
    }
    void loadDetail();
    // 다른 정책으로 이동하거나 화면을 떠나면 이전 요청과 타이머를 정리한다.
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [id, attempt]);

  const policy = state.status === 'success' ? state.data : null;
  const links = policy?.links.filter((link) => isHttpUrl(link.url)) ?? [];
  return (
    <main className="container policies-page policy-detail" id="main-content">
      <Link className="back-link" href="/policies">목록으로 돌아가기</Link>
      {state.status === 'loading' && <p role="status">정책 상세를 불러오는 중입니다.</p>}
      {state.status === 'missing' && <section className="empty-state">
        <h1>정책을 찾을 수 없습니다</h1><p>정책 주소를 다시 확인해 주세요.</p>
      </section>}
      {state.status === 'error' && <section className="empty-state" role="alert">
        <h1>정책 상세를 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요.</p>
        <button className="retry-button" type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
      </section>}
      {policy && <>
        <header className="detail-heading">
          <p className="eyebrow">{policy.category || '분야 확인 필요'}{policy.subcategory && <> · {policy.subcategory}</>}</p>
          <h1>{policy.title}</h1>
          <p><span className={`application-status status-${policy.applicationStatus.toLowerCase()}`}>{statusLabels[policy.applicationStatus]}</span>
            <span className="detail-views">조회수 {policy.viewCount === null ? '확인 필요' : `${policy.viewCount.toLocaleString('ko-KR')}회`}</span></p>
          <p>최종 신청 자격 및 접수 여부는 공식 신청처에서 확인하세요.</p>
        </header>
        <section className="detail-section" aria-labelledby="benefit-title">
          <h2 id="benefit-title">지원 내용</h2><p className="detail-text">{displayText(policy.benefitText)}</p>
        </section>
        <section className="detail-section" aria-labelledby="description-title">
          <h2 id="description-title">정책 설명</h2><p className="detail-text">{displayText(policy.description)}</p>
        </section>
        <section className="detail-section" aria-labelledby="conditions-title">
          <h2 id="conditions-title">신청 자격</h2>
          <dl className="policy-facts">
            <div><dt>나이</dt><dd>{displayText(policy.ageRangeText)}</dd></div>
            <div><dt>취업</dt><dd>{displayText(policy.jobConditionText)}</dd></div>
            <div><dt>학력</dt><dd>{displayText(policy.schoolConditionText)}</dd></div>
            <div><dt>지역</dt><dd>{displayText(policy.regionText)}</dd></div>
          </dl>
          <h3>추가 자격</h3><p className="detail-text">{displayText(policy.extraQualification)}</p>
          <h3>참여 제한</h3><p className="detail-text">{displayText(policy.participationRestriction)}</p>
        </section>
        <section className="detail-section" aria-labelledby="period-title">
          <h2 id="period-title">신청기간</h2>
          <p className="detail-text">{policy.applicationPeriodText?.trim() ? policy.applicationPeriodText
            : policy.applicationEndDate ? `신청 마감 ${policy.applicationEndDate}`
              : policy.applicationStatus === 'ALWAYS_OPEN' ? '상시 신청' : '신청기간 확인 필요'}</p>
        </section>
        <section className="detail-section" aria-labelledby="links-title">
          <h2 id="links-title">신청·참고 링크</h2>
          {links.length === 0 ? <p>링크 없음</p> : <ul className="detail-links">
            {links.map((link, index) => <li key={`${link.url}-${index}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} · {new URL(link.url).hostname} (새 탭)</a>
            </li>)}
          </ul>}
        </section>
      </>}
    </main>
  );
}
