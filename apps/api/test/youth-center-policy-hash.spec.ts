import { createHash } from 'node:crypto';
import { createYouthCenterPolicyContentHash, YouthCenterPolicyHashError } from '../src/modules/ingestion/youth-center-policy.hash';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center-response.schema';
import sample from './fixtures/youth-center-policy.json';

/** 조회수 제외·객체 키 정렬·배열 순서 보존과 해시 오류 정보를 검증한다. */
describe('온통청년 정책 내용 해시', () => {
  it('알려진 표준화 JSON의 UTF-8 SHA-256 값을 64자리 소문자 16진수로 반환한다', () => {
    const raw = { plcyNo: '0001', inqCnt: '999', plcyNm: '정책' };
    expect(createYouthCenterPolicyContentHash(raw)).toBe('de46b700601433e3700949e7a31d3c4426d68e3fe2a27bf806872992983d8eeb');
  });

  it('실제 응답 발췌본을 반복 처리해도 같은 해시다', () => {
    const hash = createYouthCenterPolicyContentHash(sample);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(createYouthCenterPolicyContentHash(structuredClone(sample))).toBe(hash);
  });

  it.each(['0', '15', '99999', '', '잘못된 조회수', null, undefined, 100, {}])(
    '최상위 조회수만 %j로 바뀌면 같은 해시다', (inqCnt) => {
      expect(createYouthCenterPolicyContentHash({ ...sample, inqCnt }))
        .toBe(createYouthCenterPolicyContentHash(sample));
    },
  );

  it('최상위 조회수가 누락된 경우와 존재하는 경우도 같은 해시다', () => {
    const raw: YouthCenterRawPolicy = { ...sample };
    Reflect.deleteProperty(raw, 'inqCnt');
    expect(createYouthCenterPolicyContentHash(raw)).toBe(createYouthCenterPolicyContentHash(sample));
  });

  it('최상위·중첩 객체와 배열 속 객체의 키 순서 변경은 해시에 영향을 주지 않는다', () => {
    const first = { plcyNo: '0001', plcyNm: '정책', extra: { z: 1, a: { b: 2, a: 1 }, list: [{ y: true, x: null }] } };
    const second = { extra: { list: [{ x: null, y: true }], a: { a: 1, b: 2 }, z: 1 }, plcyNm: '정책', plcyNo: '0001' };
    expect(createYouthCenterPolicyContentHash(first)).toBe(createYouthCenterPolicyContentHash(second));
  });

  it('정수처럼 보이는 객체 키도 문자열 키 순서로 직렬화한다', () => {
    const raw = { plcyNo: '0001', plcyNm: '정책', extra: { 2: 'two', 10: 'ten' } };
    const canonical = '{"extra":{"10":"ten","2":"two"},"plcyNm":"정책","plcyNo":"0001"}';
    expect(createYouthCenterPolicyContentHash(raw)).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
  });

  it.each([
    ['plcyNm', '바뀐 제목'], ['plcyExplnCn', '바뀐 설명'], ['jobCd', '0013003'],
    ['frstRegDt', '2026-10-01 00:00:00'], ['lastMdfcnDt', '2026-10-16 00:00:00'],
    ['unknownField', { value: '추가 정보' }],
  ])('원본 내용 %s가 바뀌면 해시도 바뀐다', (field, value) => {
    expect(createYouthCenterPolicyContentHash({ ...sample, [field]: value }))
      .not.toBe(createYouthCenterPolicyContentHash(sample));
  });

  it('중첩 객체·배열 속 inqCnt는 내용에 포함한다', () => {
    const first = { ...sample, extra: { inqCnt: '1' }, list: [{ inqCnt: '1' }] };
    expect(createYouthCenterPolicyContentHash({ ...first, extra: { inqCnt: '2' } }))
      .not.toBe(createYouthCenterPolicyContentHash(first));
    expect(createYouthCenterPolicyContentHash({ ...first, list: [{ inqCnt: '2' }] }))
      .not.toBe(createYouthCenterPolicyContentHash(first));
  });

  it('배열 원소 순서·개수·중복은 내용 변경으로 판정한다', () => {
    const first = { ...sample, list: ['0013001', '0013003'] };
    for (const list of [['0013003', '0013001'], ['0013001'], ['0013001', '0013003', '0013003']]) {
      expect(createYouthCenterPolicyContentHash({ ...first, list })).not.toBe(createYouthCenterPolicyContentHash(first));
    }
  });

  it('문자열 내용의 공백·줄바꿈·자료형을 정규화하지 않는다', () => {
    const first = { ...sample, extra: '0' };
    for (const extra of [' 0 ', '0\n', 0, null, false]) {
      expect(createYouthCenterPolicyContentHash({ ...first, extra })).not.toBe(createYouthCenterPolicyContentHash(first));
    }
    expect(createYouthCenterPolicyContentHash({ ...sample, extra: null }))
      .not.toBe(createYouthCenterPolicyContentHash(sample));
  });

  it('따옴표·역슬래시·개행이 포함된 키와 문자열을 JSON 규칙으로 이스케이프한다', () => {
    const raw = { plcyNo: '0001', plcyNm: '정책', 'a"\\\n': '가"\\\n\t', list: [null, true, false, 0, -1, 1.5] };
    const canonical = `{"a\\"\\\\\\n":${JSON.stringify(raw['a"\\\n'])},"list":[null,true,false,0,-1,1.5],"plcyNm":"정책","plcyNo":"0001"}`;
    expect(createYouthCenterPolicyContentHash(raw)).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
  });

  it('특수 키를 일반 데이터로 보존하고 프로토타입이 없는 객체도 처리한다', () => {
    const extra: Record<string, unknown> = Object.create(null);
    extra.__proto__ = '원본 값';
    Reflect.set(extra, 'constructor', '원본 생성자');
    const hash = createYouthCenterPolicyContentHash({ ...sample, extra });
    expect(hash).not.toBe(createYouthCenterPolicyContentHash({ ...sample, extra: {} }));
    expect(hash).toBe(createYouthCenterPolicyContentHash({ ...sample, extra: JSON.parse(JSON.stringify(extra)) }));
  });

  it('동일 객체를 여러 위치에서 참조하는 값은 순환 참조로 오인하지 않는다', () => {
    const extra = { z: 1, a: 2 };
    const raw = { ...sample, extra: [extra, extra] };
    expect(createYouthCenterPolicyContentHash(raw))
      .toBe(createYouthCenterPolicyContentHash(structuredClone(raw)));
  });

  it.each([undefined, Number.NaN, Infinity, -Infinity, BigInt(1), Symbol('잘못된 값'), () => 1, new Date(), new Map(), new Set()])(
    'JSON으로 표현할 수 없는 원본 값을 거부하며 필드를 전달한다: %#', (value) => {
      expect(() => createYouthCenterPolicyContentHash({ ...sample, extra: { value } })).toThrow(expect.objectContaining({
        stage: 'HASH', policyId: sample.plcyNo, field: 'extra.value', reason: 'INVALID_JSON_VALUE',
      }));
    },
  );

  it('배열의 누락 원소나 undefined를 임의로 NULL로 바꾸지 않는다', () => {
    for (const extra of [new Array(1), [undefined]]) {
      expect(() => createYouthCenterPolicyContentHash({ ...sample, extra })).toThrow(expect.objectContaining({
        field: 'extra.0', reason: 'INVALID_JSON_VALUE',
      }));
    }
  });

  it('순환 참조 오류에 정책 ID와 실제 필드 경로를 포함한다', () => {
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    expect(() => createYouthCenterPolicyContentHash({ ...sample, extra })).toThrow(expect.objectContaining({
      policyId: sample.plcyNo, field: 'extra.self', reason: 'CYCLIC_REFERENCE', stage: 'HASH',
    }));
  });

  it('원본의 최상위 조회수·키 순서·중첩 값과 배열을 변경하지 않는다', () => {
    const raw = { ...sample, extra: { z: 'z', a: 'a' }, list: [2, 1] };
    const before = structuredClone(raw);
    Object.freeze(raw.extra);
    Object.freeze(raw.list);
    Object.freeze(raw);
    createYouthCenterPolicyContentHash(raw);
    expect(raw).toEqual(before);
    expect(Object.keys(raw.extra)).toEqual(['z', 'a']);
    expect(raw.inqCnt).toBe(sample.inqCnt);
  });

  it('예상 밖 직렬화 오류를 원문·민감값·cause 없는 안전한 오류로 바꾼다', () => {
    const secret = 'hash-unit-secret';
    const raw = { ...sample, get extra() { throw new Error(`https://example.com/?apiKeyNm=${secret}`); } };
    try {
      createYouthCenterPolicyContentHash(raw);
      throw new Error('직렬화 오류를 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterPolicyHashError);
      expect(error).toMatchObject({ policyId: sample.plcyNo, field: '$', reason: 'HASH_FAILED', stage: 'HASH' });
      expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/hash-unit-secret|apiKeyNm|https:\/\/|example\.com/);
      expect(error).not.toHaveProperty('cause');
    }
  });
});
