import Link from 'next/link';
import { statusLabels } from './policy-labels';
import { formatApplicationPeriod } from './policy-period';
import type { MatchTag, PolicyCard as PolicyCardData } from '@youth-kkultong/shared';

const tagLabels: Record<MatchTag, string> = {
  AGE_MATCH: '나이 기준 부합',
  JOB_MATCH: '취업 상태 부합',
  SCHOOL_MATCH: '학력 기준 부합',
  REGION_RELATED: '지역 관련',
  EXTRA_REVIEW: '추가 조건 확인',
  AGE_REVIEW: '나이 확인 필요',
  JOB_REVIEW: '취업 확인 필요',
  SCHOOL_REVIEW: '학력 확인 필요',
  REGION_REVIEW: '지역 확인 필요',
};

/** 원본 요약에서 HTML 표시와 불필요한 공백을 정리하고 유니코드 문자 기준 100자 안으로 줄인다. */
function summarizeDescription(preview: string): string {
  // HTML을 실행하지 않고 일반 텍스트로 보여주며, 스크립트·스타일 본문도 요약에서 뺀다.
  const text = preview
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/^\s*[□■○●▪▶▷◇◆※]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '정책 소개가 제공되지 않았습니다.';

  // 이모지의 중간을 자르지 않도록 문자열을 유니코드 문자 배열로 바꿔 자른다.
  const characters = Array.from(text);
  return characters.length > 100 ? `${characters.slice(0, 99).join('')}…` : text;
}

/** API의 정책 카드 한 건을 신청 정보·조건 태그·상세 이동 링크로 보여준다. */
export function PolicyCard({ policy }: { policy: PolicyCardData }) {
  // 날짜가 불명확해도 API 기간 원문을 우선 보존하고, 없는 날짜를 만들어내지 않는다.
  const periodText = policy.applicationPeriodText?.trim()
    || (policy.applicationEndDate ? `신청 마감 ${formatApplicationPeriod(policy.applicationEndDate)}` : null)
    || (policy.applicationStatus === 'ALWAYS_OPEN' ? '상시 신청' : '신청기간 확인 필요');

  return (
    <article className="policy-card">
      {/* 카드 본문 전체를 하나의 링크로 만들어 클릭과 키보드 선택을 함께 지원한다. */}
      <Link className="policy-card-link" href={`/policies/${policy.id}`} prefetch={false}>
        <div className="policy-card-main">
          <p className="policy-category">
            <span className="policy-category-badge">{policy.category?.trim() || '분야 확인 필요'}</span>
            {policy.subcategory?.trim() && <span className="policy-subcategory">{policy.subcategory}</span>}
          </p>
          <h2>{policy.title}</h2>
          <p className="policy-description">{summarizeDescription(policy.descriptionPreview ?? '')}</p>
          {/* 판정은 API 결과를 그대로 표시하며 브라우저에서 자격·점수를 다시 계산하지 않는다. */}
          {policy.tags.length > 0 && (
            <ul className="policy-tags" aria-label="일치 및 확인 항목">
              {policy.tags.map((tag) => (
                <li className={tag.endsWith('_REVIEW') ? 'tag-review' : 'tag-match'} key={tag}>
                  {tagLabels[tag]}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="policy-card-meta">
          <span className={`application-status status-${policy.applicationStatus.toLowerCase()}`}>
            {statusLabels[policy.applicationStatus]}
          </span>
          <dl className="policy-card-stats">
            <div className="policy-card-period"><dt className="sr-only">신청기간</dt><dd title={periodText}>{formatApplicationPeriod(periodText)}</dd></div>
            <div><dt className="sr-only">조회수</dt><dd>{policy.viewCount === null ? '조회수 확인 필요' : `조회 ${policy.viewCount.toLocaleString('ko-KR')}회`}</dd></div>
          </dl>
        </div>
      </Link>
    </article>
  );
}
