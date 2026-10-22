'use client';

import type { EligibilityCodeOption, EligibilityCodesResponse } from '@youth-kkultong/shared';
import { useMetaOptions } from './use-meta-options';

/** 코드와 표시명이 모두 있는 서버 선택지만 허용한다. */
function isOptions(value: unknown): value is EligibilityCodeOption[] {
  return Array.isArray(value) && value.every((item) => item && typeof item.code === 'string'
    && /^\d+$/.test(item.code) && typeof item.label === 'string' && item.label.trim().length > 0);
}

/** 취업·학력 응답이 공용 API 계약을 만족하는지 확인한다. */
function isEligibility(value: unknown): value is EligibilityCodesResponse {
  return typeof value === 'object' && value !== null && 'jobCodes' in value && 'schoolCodes' in value
    && isOptions(value.jobCodes) && isOptions(value.schoolCodes);
}

/** 공식 취업·학력 선택지를 불러오고 확인된 코드 또는 미선택만 부모 화면에 전달한다. */
export function EligibilityFilters({ jobCode, schoolCode, onChange }: {
  jobCode: string; schoolCode: string;
  onChange: (field: 'jobCode' | 'schoolCode', code: string) => void;
}) {
  const { state, retry } = useMetaOptions('/api/v1/meta/eligibility-codes', isEligibility);
  return (
    <fieldset className="condition-filters">
      <legend>취업·학력 (선택)</legend>
      {(['jobCode', 'schoolCode'] as const).map((field) => {
        const options = state.status === 'success' ? state.data[field === 'jobCode' ? 'jobCodes' : 'schoolCodes'] : [];
        return (
          <div className="condition-select" key={field}>
            <label htmlFor={field}>{field === 'jobCode' ? '취업 상태' : '학력'}</label>
            <select id={field} value={field === 'jobCode' ? jobCode : schoolCode} disabled={state.status !== 'success'}
              onChange={(event) => {
                const code = event.target.value;
                if (code === '' || options.some((option) => option.code === code)) onChange(field, code);
              }}>
              <option value="">선택 안 함</option>
              {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select>
          </div>
        );
      })}
      {state.status === 'loading' && <p role="status">취업·학력 선택지를 불러오는 중입니다.</p>}
      {state.status === 'error' && <div><p role="alert">취업·학력 선택지를 불러오지 못했습니다. 다른 조건으로 조회할 수 있어요.</p>
        <button className="retry-button" type="button" onClick={retry}>취업·학력 다시 시도</button></div>}
    </fieldset>
  );
}
