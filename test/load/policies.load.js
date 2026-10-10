import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BASE_URL ?? 'http://127.0.0.1:3000';

export const options = {
  scenarios: {
    public_policy_search: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

/** 1,000건을 메모리 매칭하는 공개 검색 API의 목표 RPS와 응답 시간을 검증한다. */
export default function loadTest() {
  const response = http.post(
    `${baseUrl}/api/v1/policies/search`,
    JSON.stringify({ age: 27, regionCode: '11', statuses: ['JOB_SEEKER'], size: 20 }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(response, {
    '검색 응답이 성공한다': (result) => result.status === 200,
    '불일치 정책을 제외한 결과가 있다': (result) => result.json('total') > 0,
  });
}
