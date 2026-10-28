import {
  adminLoginSchema, adminLogoutSchema, adminReviewIdSchema, adminReviewQuerySchema,
  missingPolicyQuerySchema, rejectReviewSchema, reviewActionSchema,
} from '@youth-kkultong/shared';
import type {
  AdminLoginRequest, AdminReviewQuery, MissingPolicyQuery, RejectReviewRequest, ReviewActionRequest,
} from '@youth-kkultong/shared';

const reviewId = '00000000-0000-4000-8000-000000000001';
const targetHash = '0123456789abcdef'.repeat(4);
const baseHash = 'b'.repeat(64);
const action = { contentHash: targetHash, baseContentHash: baseHash };

describe('관리자 로그인·로그아웃 입력', () => {
  it('식별자 1~64자·비밀번호 1~256자 경계를 허용하고 비밀번호 공백은 보존한다', () => {
    for (const [username, password] of [['a', ' '], ['가'.repeat(64), 'p'.repeat(256)], ['admin', ' \t암호\n ']]) {
      const request: AdminLoginRequest = { username, password };
      expect(adminLoginSchema.parse(request)).toEqual(request);
    }
  });

  it.each([
    undefined, null, [], 'admin', {}, { username: 'admin' }, { password: 'password' },
    { username: '', password: 'p' }, { username: 'a'.repeat(65), password: 'p' },
    { username: ' admin', password: 'p' }, { username: 'ad min', password: 'p' },
    { username: 'admin\n', password: 'p' }, { username: 'admin\t', password: 'p' },
    { username: '관리자\u3000', password: 'p' }, { username: null, password: 'p' },
    { username: ['admin'], password: 'p' }, { username: 'admin', password: '' },
    { username: 'admin', password: 'p'.repeat(257) }, { username: 'admin', password: null },
    { username: 'admin', password: 1234 }, { username: 'admin', password: ['password'] },
    { username: 'admin', password: 'p', role: 'admin' },
  ])('누락·형식 오류·추가 필드가 있는 로그인을 거부한다: %j', (request) => {
    expect(adminLoginSchema.safeParse(request).success).toBe(false);
  });

  it('로그아웃은 빈 JSON 객체만 허용한다', () => {
    expect(adminLogoutSchema.parse({})).toEqual({});
  });

  it.each([undefined, null, [], '', 0, { username: 'admin' }, { token: 'dummy-token' }])(
    '빈 객체가 아닌 로그아웃 본문을 거부한다: %j', (request) => {
      expect(adminLogoutSchema.safeParse(request).success).toBe(false);
    },
  );
});

describe('관리자 승인·거절 입력', () => {
  it('기존 공개본의 두 해시와 신규 후보의 명시적 NULL 기준 해시를 허용한다', () => {
    for (const baseContentHash of [baseHash, null]) {
      const request: ReviewActionRequest = { contentHash: targetHash, baseContentHash };
      expect(reviewActionSchema.parse(request)).toEqual(request);
    }
  });

  for (const field of ['contentHash', 'baseContentHash'] as const) {
    it.each([
      undefined, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64),
      ` ${targetHash}`, `${targetHash}\n`, 1, [targetHash], { hash: targetHash },
    ])(`${field}의 잘못된 해시를 거부한다: %j`, (hash) => {
      expect(reviewActionSchema.safeParse({ ...action, [field]: hash }).success).toBe(false);
      expect(rejectReviewSchema.safeParse({ ...action, [field]: hash, reason: '사유' }).success).toBe(false);
    });
  }

  it.each([
    undefined, null, [], {}, { contentHash: targetHash }, { baseContentHash: null },
    { ...action, contentHash: null }, { ...action, reason: '승인에는 없는 사유' },
    { ...action, raw: { plcyNm: '화면에서 바꾼 본문' } },
  ])('필드 누락·NULL 대상 해시·추가 필드가 있는 승인을 거부한다: %j', (request) => {
    expect(reviewActionSchema.safeParse(request).success).toBe(false);
  });

  it.each(['가', '가'.repeat(1000), '<script>텍스트</script>\n  둘째 줄'])('거절 사유의 경계·원문을 보존한다', (reason) => {
    const request: RejectReviewRequest = { contentHash: targetHash, baseContentHash: null, reason };
    expect(rejectReviewSchema.parse({ ...request, reason: ` \t${reason}\n ` })).toEqual(request);
  });

  it.each([undefined, null, '', ' \n\t\u3000', '가'.repeat(1001), 1, ['사유'], { text: '사유' }])(
    '빈 값·길이 초과·잘못된 형식의 거절 사유를 거부한다: %j', (reason) => {
      expect(rejectReviewSchema.safeParse({ ...action, reason }).success).toBe(false);
    },
  );

  it('거절도 해시 누락과 추가 필드를 거부한다', () => {
    expect(rejectReviewSchema.safeParse({ contentHash: targetHash, reason: '사유' }).success).toBe(false);
    expect(rejectReviewSchema.safeParse({ ...action, reason: '사유', status: 'REJECTED' }).success).toBe(false);
  });
});

for (const [name, schema] of [['검수', adminReviewQuerySchema], ['누락', missingPolicyQuerySchema]] as const) {
  describe(`${name} 목록의 공통 query 입력`, () => {
    it('양의 정수 문자열을 숫자로 바꾸고 검색어의 앞뒤 공백만 제거한다', () => {
      const parsed = schema.parse({ page: '02', limit: '50', keyword: '  청년 %_ A  B\n ' });
      expect(parsed).toMatchObject({ page: 2, limit: 50, keyword: '청년 %_ A  B' });
    });

    it('페이지 최댓값과 검색어 길이 100자를 허용한다', () => {
      expect(schema.parse({ page: String(Number.MAX_SAFE_INTEGER), limit: '1', keyword: ` ${'가'.repeat(100)} ` }))
        .toMatchObject({ page: Number.MAX_SAFE_INTEGER, limit: 1, keyword: '가'.repeat(100) });
    });

    it('빈 검색어와 공백뿐인 검색어는 빈 문자열로 전달한다', () => {
      expect(schema.parse({ keyword: '' }).keyword).toBe('');
      expect(schema.parse({ keyword: ' \n\t ' }).keyword).toBe('');
    });

    it.each([undefined, null, [], 'page=1', { extra: 'value' }, { keyword: '가'.repeat(101) },
      { keyword: null }, { keyword: 123 }, { keyword: ['청년', '청년'] }])(
      '잘못된 query 객체·검색어·추가 필드를 거부한다: %j', (query) => {
        expect(schema.safeParse(query).success).toBe(false);
      },
    );

    for (const field of ['page', 'limit'] as const) {
      it.each([
        '', '0', '000', '-1', '+1', '1.5', '1e1', '0x10', 'Infinity', 'NaN',
        ' 1', '1 ', '1\n', '１', String(Number.MAX_SAFE_INTEGER + 1),
        '9'.repeat(400), null, 1, true, ['1', '1'], { value: '1' },
      ])(`${field}의 잘못된 정수 문자열과 중복 query 배열을 거부한다: %j`, (value) => {
        expect(schema.safeParse({ [field]: value }).success).toBe(false);
      });
    }

    it('페이지 범위와 별개로 limit 51 이상을 거부한다', () => {
      expect(schema.safeParse({ limit: '51' }).success).toBe(false);
    });
  });
}

describe('검수·처리 이력 필터', () => {
  it('빈 query는 첫 페이지·20개·PENDING으로 시작한다', () => {
    const request: AdminReviewQuery = adminReviewQuerySchema.parse({});
    expect(request).toEqual({ page: 1, limit: 20, status: 'PENDING' });
  });

  it.each(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'PROCESSED'])('상태 %s를 허용한다', (status) => {
    expect(adminReviewQuerySchema.parse({ status }).status).toBe(status);
  });

  it.each(['NEW', 'CHANGED'])('종류 %s와 나머지 필터를 함께 보존한다', (kind) => {
    expect(adminReviewQuerySchema.parse({ status: 'PROCESSED', kind, sourcePolicyId: reviewId, keyword: ' 정책 ' }))
      .toEqual({ page: 1, limit: 20, status: 'PROCESSED', kind, sourcePolicyId: reviewId, keyword: '정책' });
  });

  it.each([
    { status: 'processed' }, { status: '' }, { status: null }, { status: ['PENDING', 'PENDING'] },
    { kind: 'MISSING' }, { kind: '' }, { kind: null }, { kind: ['NEW', 'NEW'] },
    { sourcePolicyId: '없는 ID' }, { sourcePolicyId: null }, { sourcePolicyId: [reviewId, reviewId] },
    { minMissingCount: '1' },
  ])('잘못된 필터·NULL·중복 필터·다른 목록의 필드를 거부한다: %j', (query) => {
    expect(adminReviewQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('누락 목록 필터', () => {
  it('빈 query는 첫 페이지·20개·최소 1회 누락으로 시작한다', () => {
    const request: MissingPolicyQuery = missingPolicyQuerySchema.parse({});
    expect(request).toEqual({ page: 1, limit: 20, minMissingCount: 1 });
  });

  it.each(['1', '2147483647'])('최소 누락 횟수 경계 %s를 허용한다', (minMissingCount) => {
    expect(missingPolicyQuerySchema.parse({ minMissingCount }).minMissingCount).toBe(Number(minMissingCount));
  });

  it.each(['', '0', '-1', '+1', '1.5', '1e1', ' 1', '1\n', '2147483648', null, 1, ['1', '1']])(
    '잘못된 누락 횟수·정수 상한 초과·중복 값을 거부한다: %j', (minMissingCount) => {
      expect(missingPolicyQuerySchema.safeParse({ minMissingCount }).success).toBe(false);
    },
  );

  it.each([{ status: 'PENDING' }, { kind: 'NEW' }, { sourcePolicyId: reviewId }])('검수 전용 필터를 거부한다: %j', (query) => {
    expect(missingPolicyQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('검수 UUID 경로값', () => {
  it('정상 UUID를 보존한다', () => {
    expect(adminReviewIdSchema.parse(reviewId)).toBe(reviewId);
  });

  it.each([undefined, null, '', 'not-a-uuid', reviewId.replaceAll('-', ''), ` ${reviewId}`, [reviewId], 1])(
    '잘못된 UUID를 거부한다: %j', (id) => {
      expect(adminReviewIdSchema.safeParse(id).success).toBe(false);
    },
  );
});
