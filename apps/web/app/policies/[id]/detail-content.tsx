'use client';

import { useState } from 'react';

/** 긴 원문의 앞부분만 먼저 보여주고 버튼으로 원문 전체를 펼치거나 접는다. */
export function ExpandableText({ id, label, text, limit = 360, lines = 5 }: {
  id: string; label: string; text: string; limit?: number; lines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // 문장을 새로 요약하거나 조건을 추정하지 않고 원문 앞부분을 그대로 사용한다.
  const preview = Array.from(text.split('\n').slice(0, lines).join('\n')).slice(0, limit).join('').trimEnd();
  const canExpand = preview.length < text.trimEnd().length;
  return (
    <div className="expandable-text">
      <p className="detail-text" id={id}>{canExpand && !expanded ? `${preview}…` : text}</p>
      {canExpand && <button type="button" className="detail-expand-button" aria-expanded={expanded}
        aria-controls={id} onClick={() => setExpanded((value) => !value)}>
        {label} {expanded ? '접기' : '더보기'} <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>}
    </div>
  );
}

/** 길게 나열된 지역을 시·도별로 묶고 검색·접기/펼치기로 필요한 이름만 찾게 한다. */
export function DetailRegions({ text }: { text: string | null }) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const regions = text?.split(',').map((name) => name.trim()).filter(Boolean) ?? [];
  const groups = new Map<string, string[]>();
  const keyword = query.trim().toLocaleLowerCase('ko-KR');
  for (const name of regions) {
    if (keyword && !name.toLocaleLowerCase('ko-KR').includes(keyword)) continue;
    // 표시명만 묶는다. 많은 지역이 있다는 이유로 '전국 대상'이나 자격 충족을 추정하지 않는다.
    const firstWord = name.split(/\s+/)[0];
    const province = /(?:특별시|광역시|특별자치시|특별자치도|도)$/.test(firstWord) ? firstWord : '기타 지역';
    const names = groups.get(province) ?? [];
    names.push(name);
    groups.set(province, names);
  }
  // 처음에는 세 묶음만 보여준다. 검색 중에는 뒤에 접힌 지역까지 모두 검색한다.
  const entries = Array.from(groups);
  const visibleGroups = keyword || showAll ? entries : entries.slice(0, 3);
  return (
    <div className="detail-regions">
      <div className="region-section-heading">
        <div><h3>거주 지역</h3><p>{regions.length ? `등록된 ${regions.length}개 지역 중 내 지역을 찾아보세요.` : '지역 정보는 공식 신청처에서 확인해 주세요.'}</p></div>
        {regions.length > 0 && <label className="detail-region-search">
          <span>지역 찾기</span><input type="search" placeholder="예: 수원시, 강남구" value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </label>}
      </div>
      {regions.length > 0 && <>
        <p className="region-search-result" role="status">{keyword ? `${Array.from(groups.values()).flat().length}개 지역 검색됨` : '시·도를 펼치면 상세 지역을 볼 수 있어요.'}</p>
        <div className="detail-region-groups">
          {visibleGroups.map(([province, names]) => (
            <details className="detail-region-group" key={province} open={keyword ? true : undefined}>
              <summary>{province}<span>{names.length}개 지역</span></summary>
              <ul>{names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>
            </details>
          ))}
        </div>
        {!keyword && entries.length > 3 && <button className="detail-expand-button" type="button"
          aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          지역 목록 {showAll ? '접기' : '더보기'} <span aria-hidden="true">{showAll ? '−' : '+'}</span>
        </button>}
        {groups.size === 0 && <p className="region-no-result">일치하는 지역이 없습니다. 다른 지역명으로 찾아보세요.</p>}
      </>}
    </div>
  );
}
