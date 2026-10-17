import { createPolicySearchSchema } from '@youth-kkultong/shared';
import type { PolicySearchRequest } from '@youth-kkultong/shared';
import snapshot from '../src/database/seeds/regions.json';

// 현행 지역과 SPEC의 제한 없음 취업·학력 코드를 허용하는 테스트용 검색 스키마.
const searchSchema = createPolicySearchSchema({
  regionCodes: new Set(snapshot.regions.filter((region) => region.isActive).map((region) => region.code)),
  jobCodes: new Set(['0013010']),
  schoolCodes: new Set(['0049010']),
});

describe('정책 검색 요청 스키마', () => {
  it('빈 객체에 페이지·크기·마감 포함 기본값만 채운다', () => {
    const result: PolicySearchRequest = searchSchema.parse({});
    expect(result).toEqual({ page: 1, limit: 20, includeClosed: false });
  });

  it('모든 선택값을 보존하며 분야를 정확 일치 비교하도록 바꾸지 않는다', () => {
    const input: PolicySearchRequest = {
      page: 2, limit: 50, category: ' 주거 ', includeClosed: true, sort: 'deadline',
      conditions: { age: 28, regionCode: '11680', jobCode: '0013010', schoolCode: '0049010' },
    };
    expect(searchSchema.parse(input)).toEqual(input);
  });

  it.each([1, 120])('나이 경계값 %i를 허용한다', (age) => {
    expect(searchSchema.parse({ conditions: { age } }).conditions?.age).toBe(age);
  });

  it.each(['recommended', 'popular', 'deadline', 'newest'])('%s 정렬을 허용한다', (sort) => {
    expect(searchSchema.parse({ sort }).sort).toBe(sort);
  });

  it.each([{ category: '' }, { conditions: {} }, { conditions: { age: 28 } }])(
    '비어 있는 분야·조건과 선택 입력을 허용한다: %j', (input) => {
      expect(searchSchema.safeParse(input).success).toBe(true);
    },
  );

  it('조건 없는 맞춤순은 검증에서 바꾸지 않고 검색 서비스에 전달한다', () => {
    expect(searchSchema.parse({ sort: 'recommended' }).sort).toBe('recommended');
  });

  it.each([
    undefined, null, [], '문자열', 1,
    { page: 0 }, { page: -1 }, { page: 1.5 }, { page: '1' }, { page: null },
    { page: Number.MAX_SAFE_INTEGER + 1 }, { page: Infinity }, { page: NaN },
    { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: '20' }, { limit: null },
    { includeClosed: 'false' }, { includeClosed: 0 }, { includeClosed: null },
    { sort: 'invalid' }, { sort: '' }, { sort: null }, { category: 1 }, { category: null },
    { conditions: null }, { conditions: [] }, { conditions: '입력' },
    { conditions: { age: 0 } }, { conditions: { age: 121 } },
    { conditions: { age: 28.5 } }, { conditions: { age: '28' } }, { conditions: { age: null } },
    { conditions: { regionCode: '28110' } }, // 공식 폐지 코드
    { conditions: { regionCode: '99999' } }, { conditions: { regionCode: '1168' } },
    { conditions: { regionCode: '116800' } }, { conditions: { regionCode: 11680 } },
    { conditions: { regionCode: '' } }, { conditions: { regionCode: null } },
    { conditions: { jobCode: '9999999' } }, { conditions: { schoolCode: '9999999' } },
    { conditions: { jobCode: '' } }, { conditions: { schoolCode: '' } },
    { conditions: { jobCode: 13010 } }, { conditions: { schoolCode: null } },
  ])('잘못된 요청을 거부한다: %j', (input) => {
    expect(searchSchema.safeParse(input).success).toBe(false);
  });

  it('허용 목록이 비었을 때 임의 코드를 허용하지 않는다', () => {
    const schema = createPolicySearchSchema({
      regionCodes: new Set(), jobCodes: new Set(), schoolCodes: new Set(),
    });
    expect(schema.safeParse({}).success).toBe(true);
    for (const conditions of [{ regionCode: '11680' }, { jobCode: '0013010' }, { schoolCode: '0049010' }]) {
      expect(schema.safeParse({ conditions }).success).toBe(false);
    }
  });
});
