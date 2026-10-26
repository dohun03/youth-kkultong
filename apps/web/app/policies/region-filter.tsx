'use client';

import type { RegionOption } from '@youth-kkultong/shared';
import type { MetaState } from './use-meta-options';

/** 현행 지역 메타 응답의 필수 필드와 코드 형식을 확인한다. */
export function isRegions(value: unknown): value is RegionOption[] {
  return Array.isArray(value) && value.every((item) => item && typeof item.code === 'string'
    && /^\d{5}$/.test(item.code) && typeof item.name === 'string' && item.name.trim().length > 0
    && typeof item.provinceName === 'string'
    && (item.parentCode === null || (typeof item.parentCode === 'string' && /^\d{5}$/.test(item.parentCode))));
}

/** 현행 지역의 실제 부모 관계를 따라 선택 단계를 표시하고 최종 선택 코드만 전달한다. */
export function RegionFilter({ regionCode, onChange, state, retry }: { regionCode: string; onChange: (code: string) => void; state: MetaState<RegionOption[]>; retry: () => void }) {
  const regions = state.status === 'success' ? state.data : [];
  const byCode = new Map(regions.map((region) => [region.code, region]));
  const path: RegionOption[] = [];
  const visited = new Set<string>();
  let current = byCode.get(regionCode);
  // 시·도부터 선택 지역까지 경로를 만든다. 잘못된 순환 자료로 화면이 멈추는 것도 방지한다.
  while (current && !visited.has(current.code)) {
    path.unshift(current);
    visited.add(current.code);
    current = current.parentCode ? byCode.get(current.parentCode) : undefined;
  }
  const levels = [regions.filter((region) => region.parentCode === null)];
  for (const region of path) {
    const children = regions.filter((child) => child.parentCode === region.code);
    if (children.length > 0) levels.push(children);
  }
  return (
    <fieldset className="condition-filters region-filter">
      <legend className="sr-only">거주 지역 (선택)</legend>
      {levels.map((options, level) => (
        <div className="condition-select" key={level}>
          <label htmlFor={`region-${level}`}>{['거주 지역', '시·군·구', '구'][level] ?? '하위 지역'}</label>
          <select id={`region-${level}`} value={path[level]?.code ?? ''} disabled={state.status !== 'success'}
            onChange={(event) => {
              const code = event.target.value;
              // 상위 지역을 바꾸면 그 아래 선택은 경로에서 자동으로 사라진다.
              if (code === '' || options.some((option) => option.code === code)) onChange(code || path[level - 1]?.code || '');
            }}>
            <option value="">{level === 0 ? '선택 안 함' : '전체'}</option>
            {options.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}
          </select>
        </div>
      ))}
      <p>지역을 선택하면 맞춤순에서 지역 관련 정책을 먼저 보여주며, 다른 지역의 정책도 표시됩니다. ‘지역 관련’은 신청 자격 충족을 뜻하지 않습니다. 재학·재직·전입 조건은 정책 상세에서 확인해 주세요.</p>
      {state.status === 'loading' && <p role="status">지역 선택지를 불러오는 중입니다.</p>}
      {state.status === 'error' && <div><p role="alert">지역 선택지를 불러오지 못했습니다. 다른 조건으로 조회할 수 있어요.</p>
        <button className="retry-button" type="button" onClick={retry}>지역 다시 시도</button></div>}
    </fieldset>
  );
}
