import type { PolicyDetail, PolicyListResponse } from '@kkultong/contracts';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3000';

/** 공개 정책 목록을 현재 페이지 기준으로 불러온다. */
export async function fetchPolicies(page: number, signal?: AbortSignal): Promise<PolicyListResponse> {
  const url = new URL('/api/v1/policies', apiOrigin);
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', '20');

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error('정책 목록을 불러오지 못했습니다.');
  }

  return (await response.json()) as PolicyListResponse;
}

/** 공개 가능한 정책 상세를 불러온다. 존재하지 않거나 공개할 수 없는 정책은 null로 구분한다. */
export async function fetchPolicy(id: string, signal?: AbortSignal): Promise<PolicyDetail | null> {
  const url = new URL(`/api/v1/policies/${id}`, apiOrigin);
  const response = await fetch(url, { signal });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('정책 상세를 불러오지 못했습니다.');
  }

  return (await response.json()) as PolicyDetail;
}
