'use client';

import { useEffect, useState } from 'react';
import { parsePolicyCategories } from '@youth-kkultong/shared';
import type { SortKey } from '@youth-kkultong/shared';

/** 기존 조건 저장값도 그대로 읽을 수 있도록 같은 탭 전용 키를 유지한다. */
const storageKey = 'youth-kkultong:conditions';

/** 개인 조건과 목록 필터·수동 정렬을 보관하며 페이지와 오류 입력 문구는 제외한다. */
type SessionExploration = { age?: number; jobCode?: string; schoolCode?: string; regionCode?: string; category?: string; includeClosed?: boolean; sort?: SortKey; limit?: number; keyword?: string };

/** 저장소 내용을 신뢰하지 않고 필요한 필드의 자료형·범위부터 확인한다. */
function readConditions(value: unknown): SessionExploration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const conditions: SessionExploration = {};
  if (typeof input.age === 'number' && Number.isInteger(input.age) && input.age >= 1 && input.age <= 120) conditions.age = input.age;
  for (const field of ['jobCode', 'schoolCode', 'regionCode'] as const) {
    const code = input[field];
    if (typeof code === 'string' && (field === 'regionCode' ? /^\d{5}$/ : /^\d{7}$/).test(code)) conditions[field] = code;
  }
  // 반복된 단일 분야는 복원하고, 복수 분야는 임의로 고르지 않고 전체로 돌아간다.
  if (typeof input.category === 'string') {
    const categories = parsePolicyCategories(input.category);
    if (categories.length === 1) conditions.category = categories[0];
  }
  // 문자열 'false'를 참으로 해석하지 않고 실제 boolean만 허용한다. 기본값은 저장하지 않는다.
  if (input.includeClosed === true) conditions.includeClosed = true;
  if (input.sort === 'popular' || input.sort === 'recommended' || input.sort === 'deadline' || input.sort === 'newest') conditions.sort = input.sort;
  if (input.limit === 10 || input.limit === 20 || input.limit === 50) conditions.limit = input.limit;
  if (typeof input.keyword === 'string' && input.keyword.trim().length <= 100 && input.keyword.trim()) conditions.keyword = input.keyword.trim();
  return conditions;
}

/** 브라우저에서만 조건을 복원하며 저장소 접근이 차단돼도 메모리에서 탐색을 계속한다. */
export function useSessionExploration() {
  const [conditions, setConditions] = useState<SessionExploration>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored) setConditions(readConditions(JSON.parse(stored)));
    } catch {
      // 손상된 JSON·접근 차단에는 조건 없이 시작한다. 개인 조건과 오류 원문은 로그에 쓰지 않는다.
    }
    setReady(true);
  }, []);
  useEffect(() => {
    // 최초 복원이 끝나기 전에 빈 초기값으로 기존 조건을 지우지 않는다.
    if (!ready) return;
    try {
      if (Object.keys(conditions).length) window.sessionStorage.setItem(storageKey, JSON.stringify(conditions));
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      // 저장 공간 부족·접근 차단이어도 화면의 조건 선택과 검색은 계속 동작한다.
    }
  }, [conditions, ready]);
  return { conditions, setConditions, ready };
}
