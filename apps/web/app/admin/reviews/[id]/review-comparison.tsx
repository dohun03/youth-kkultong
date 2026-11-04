'use client';

import { useId, useState } from 'react';
import type { JsonValue, PolicyFieldDiff, PolicySnapshot } from '@youth-kkultong/shared';

// 공개 탐색에서 사용하는 원본 필드는 한국어로 표시하고 나머지는 원래 키로 분류
const fieldLabels: Record<string, string> = {
  plcyNo: '외부 정책 ID', plcyNm: '정책 제목', lclsfNm: '분야', mclsfNm: '세부 분야',
  plcyExplnCn: '정책 소개', plcySprtCn: '지원 내용', aplyPrdSeCd: '신청기간 코드', aplyYmd: '신청기간',
  sprtTrgtMinAge: '최소 나이', sprtTrgtMaxAge: '최대 나이', jobCd: '취업 조건 코드', schoolCd: '학력 조건 코드',
  zipCd: '지역 코드', addAplyQlfcCndCn: '추가 자격', ptcpPrpTrgtCn: '참여 제한',
  aplyUrlAddr: '신청 URL', refUrlAddr1: '참고 URL 1', refUrlAddr2: '참고 URL 2',
  frstRegDt: '원본 최초 등록 시각', lastMdfcnDt: '원본 최종 수정 시각',
};

/** 원문은 그대로 표시하고 실제로 열 수 있는 절대 HTTP(S) 주소만 링크로 허용 */
function safeHttpHref(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /[\u0000-\u0020\u007f]/.test(text)) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? text : null;
  } catch { return null; }
}

/** 없는 필드와 NULL 및 값의 자료형을 구분하고 긴 원문을 공백 그대로 펼쳐 표시 */
function RawValue({ value, exists, label, link = false }: {
  value: JsonValue | undefined; exists: boolean; label: string; link?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (!exists || value === undefined) return <p className="review-value-empty">필드 없음</p>;
  if (value === null) return <p className="review-value-empty">NULL</p>;
  if (value === '') return <p className="review-value-empty">빈 문자열 (&quot;&quot;)</p>;
  const type = typeof value === 'string' ? '문자열' : typeof value === 'number' ? '숫자'
    : typeof value === 'boolean' ? '불리언' : Array.isArray(value) ? '배열' : '객체';
  // 공백뿐인 문자열은 이스케이프 표기로 내용과 길이를 구분하고 나머지 문자열은 원문 유지
  const text = typeof value === 'string' ? (value.trim() === '' ? JSON.stringify(value) : value) : JSON.stringify(value, null, 2);
  const preview = Array.from(text.split('\n').slice(0, 8).join('\n')).slice(0, 400).join('');
  const canExpand = preview.length < text.length;
  const href = link ? safeHttpHref(value) : null;
  return <div className="review-raw-value">
    <span className="review-value-type">{type}</span>
    <pre id={contentId}>{canExpand && !expanded ? `${preview}…` : text}</pre>
    {canExpand && <button type="button" className="review-expand" aria-expanded={expanded} aria-controls={contentId}
      onClick={() => setExpanded((previous) => !previous)}>{label} {expanded ? '접기' : '더보기'}</button>}
    {href && <a className="review-source-link" href={href} target="_blank" rel="noopener noreferrer">{label} 링크 열기</a>}
  </div>;
}

/** 서버가 판정한 변경 항목과 보관된 두 스냅샷을 함께 표시하는 비교 화면 */
export function ReviewComparison({ base, target, changedFields }: {
  base: PolicySnapshot | null; target: PolicySnapshot; changedFields: PolicyFieldDiff[];
}) {
  const [showAll, setShowAll] = useState(false);
  const changed = new Set(changedFields.filter(({ key }) => key !== 'inqCnt').map(({ key }) => key));
  const keys = showAll ? [...new Set([...Object.keys(base?.raw ?? {}), ...Object.keys(target.raw)])].filter((key) => key !== 'inqCnt') : [...changed];
  const known = Object.keys(fieldLabels).filter((key) => keys.includes(key));
  // __proto__ 같은 원문 키도 일반 필드로 처리해 이름과 값을 그대로 보존
  const unknown = keys.filter((key) => !Object.hasOwn(fieldLabels, key)).sort();

  /** 한 필드의 기준본과 변경본을 나란히 배치하고 추가 및 삭제와 변경을 명시 */
  function renderField(key: string) {
    const beforeExists = base !== null && Object.hasOwn(base.raw, key);
    const afterExists = Object.hasOwn(target.raw, key);
    const label = Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : key;
    const difference = !changed.has(key) ? '동일' : !beforeExists ? '추가' : !afterExists ? '삭제' : '변경';
    const link = ['aplyUrlAddr', 'refUrlAddr1', 'refUrlAddr2'].includes(key);
    return <article key={key} className={`review-field${changed.has(key) ? ' is-different' : ''}`} data-field={key}>
      <h4>{label}{label !== key && <code>{key}</code>}<span className="review-change-kind">{difference}</span></h4>
      <div className="review-value-columns">
        <section aria-label={`${label} 기준본`}><h5>공개 기준본</h5>
          <RawValue value={base?.raw[key]} exists={beforeExists} label={`${label} 기준본`} link={link} /></section>
        <section aria-label={`${label} 변경본`}><h5>검수 변경본</h5>
          <RawValue value={target.raw[key]} exists={afterExists} label={`${label} 변경본`} link={link} /></section>
      </div>
    </article>;
  }

  return <section className="review-comparison" aria-labelledby="review-comparison-title">
    <div className="review-section-heading"><div><h3 id="review-comparison-title">정책 내용 비교</h3>
      <p className="admin-description">변경 항목 {changed.size.toLocaleString('ko-KR')}개 · 조회수는 최신 수집 정보에서 확인할 수 있습니다.</p></div>
      <label className="review-show-all"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />전체 항목 보기</label></div>
    <div className="review-comparison-headings"><p>공개 기준본 <span>후보 생성 당시</span></p><p>검수 변경본 <span>승인 검토 대상</span></p></div>
    {base === null && <div className="review-info"><strong>후보 생성 당시 공개 기준본</strong><p>아직 공개된 정책이 없습니다</p></div>}
    {keys.length === 0 && <p className="admin-list-state">{showAll ? '표시할 원본 항목이 없습니다.' : '변경된 본문 항목이 없습니다. 전체 항목으로 확인할 수 있습니다.'}</p>}
    {known.length > 0 && <div className="review-field-group">{known.map(renderField)}</div>}
    {unknown.length > 0 && <section className="review-field-group" aria-labelledby="review-other-fields">
      <h3 id="review-other-fields">기타 변경 항목</h3><p className="admin-description">추가 원본 항목은 원래 필드 이름으로 표시합니다.</p>{unknown.map(renderField)}
    </section>}
  </section>;
}

/** 현재 공개된 정책의 원문을 같은 값 표시 규칙으로 읽는 펼침 영역 */
export function CurrentPublishedSnapshot({ snapshot }: { snapshot: PolicySnapshot }) {
  return <details className="review-current-snapshot"><summary>현재 공개본 전체 항목 보기</summary>
    <dl>{Object.keys(snapshot.raw).filter((key) => key !== 'inqCnt').sort().map((key) => {
      const label = Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : key;
      return <div key={key}><dt>{label}{label !== key && <code>{key}</code>}</dt><dd>
        <RawValue value={snapshot.raw[key]} exists label={`현재 공개본 ${label}`} link={['aplyUrlAddr', 'refUrlAddr1', 'refUrlAddr2'].includes(key)} />
      </dd></div>;
    })}</dl>
  </details>;
}
