'use client';

import { useEffect, useState } from 'react';

/** 선택지 조회의 로딩·실패·정상 결과를 구분한다. */
export type MetaState<T> = { status: 'loading' } | { status: 'error' } | { status: 'success'; data: T };

/** 분야·자격 등 선택지 API의 검증·시간 제한·재시도·요청 정리를 함께 처리한다. */
export function useMetaOptions<T>(path: string, validate: (value: unknown) => value is T) {
  const [state, setState] = useState<MetaState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    /** API 실패와 응답 형식 오류를 빈 선택지로 숨기지 않고 오류로 전달한다. */
    async function load(): Promise<void> {
      setState({ status: 'loading' });
      try {
        const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('선택지 조회 실패');
        const data: unknown = await response.json();
        if (!validate(data)) throw new Error('선택지 형식 오류');
        if (active) setState({ status: 'success', data });
      } catch {
        if (active) setState({ status: 'error' });
      } finally { clearTimeout(timeout); }
    }
    void load();
    // 페이지를 떠나면 이전 응답이 새 화면 상태에 영향을 주지 않도록 취소한다.
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [path, validate, attempt]);
  return { state, retry: () => setAttempt((value) => value + 1) };
}

/** 분야는 서버가 반환한 비어 있지 않은 문자열 배열만 선택지로 사용한다. */
export function isCategories(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}
