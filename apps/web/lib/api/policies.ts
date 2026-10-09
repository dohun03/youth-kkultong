import type {
  PolicyCategory,
  PolicyDetail,
  PolicyListResponse,
  PolicySearchResponse,
  SearchCriteria,
  UserStatus,
} from '@kkultong/contracts';

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

/** 검색 폼에 필요한 선택지를 한 번에 불러온다. */
export async function fetchSearchOptions(signal?: AbortSignal): Promise<SearchOptions> {
  const [regions, categories, statuses] = await Promise.all([
    fetchJson<RegionOption[]>('/api/v1/meta/regions', signal),
    fetchJson<PolicyCategory[]>('/api/v1/meta/categories', signal),
    fetchJson<UserStatus[]>('/api/v1/meta/statuses', signal),
  ]);

  return { regions, categories, statuses };
}

/** 입력한 조건으로 정책을 검색한다. 민감할 수 있는 조건은 URL이 아닌 body에 담는다. */
export async function searchPolicies(
  criteria: SearchCriteria,
  signal?: AbortSignal,
): Promise<PolicySearchResponse> {
  const url = new URL('/api/v1/policies/search', apiOrigin);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criteria),
    signal,
  });

  if (!response.ok) {
    throw new Error('조건에 맞는 정책을 불러오지 못했습니다.');
  }

  return (await response.json()) as PolicySearchResponse;
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

interface RegionOption {
  code: string;
  name: string;
}

export interface SearchOptions {
  regions: RegionOption[];
  categories: PolicyCategory[];
  statuses: UserStatus[];
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, apiOrigin), { signal });

  if (!response.ok) {
    throw new Error('검색 조건을 불러오지 못했습니다.');
  }

  return (await response.json()) as T;
}
