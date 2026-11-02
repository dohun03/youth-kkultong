import type { JsonValue, PolicyFieldDiff } from '@youth-kkultong/shared';
import { calculatePolicyFieldDiff } from '../src/modules/policies/policy-field-diff';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';

/** 검수 스냅샷 비교의 필드 존재 여부와 원문 보존 및 기존 내용 해시와의 일치를 검증 */
describe('검수 변경 내용 비교 (T2-35)', () => {
  it('신규 후보의 모든 필드를 NULL 값까지 추가로 표시하고 조회수는 제외한다', () => {
    expect(calculatePolicyFieldDiff(null, { z: null, inqCnt: 10, a: '신규' })).toEqual([
      { key: 'a', beforeExists: false, afterExists: true, before: null, after: '신규' },
      { key: 'z', beforeExists: false, afterExists: true, before: null, after: null },
    ]);
    expect(calculatePolicyFieldDiff(null, {})).toEqual([]);
  });

  it('필드 추가와 삭제를 명시적 NULL과 구분한다', () => {
    expect(calculatePolicyFieldDiff(
      { deleted: '삭제', deletedNull: null, keptNull: null, value: '기존' },
      { added: '추가', addedNull: null, keptNull: null, value: null },
    )).toEqual([
      { key: 'added', beforeExists: false, afterExists: true, before: null, after: '추가' },
      { key: 'addedNull', beforeExists: false, afterExists: true, before: null, after: null },
      { key: 'deleted', beforeExists: true, afterExists: false, before: '삭제', after: null },
      { key: 'deletedNull', beforeExists: true, afterExists: false, before: null, after: null },
      { key: 'value', beforeExists: true, afterExists: true, before: '기존', after: null },
    ]);
  });

  it('입력 키 순서와 무관하게 숫자 형태와 한글을 포함한 키를 문자열 오름차순으로 반환한다', () => {
    const first = { 한글: 1, z: 1, 2: 1, 10: 1, A: 1, a: 1 };
    const reversed = Object.fromEntries(Object.entries(first).reverse());
    expect(calculatePolicyFieldDiff(null, first).map(({ key }) => key))
      .toEqual(['10', '2', 'A', 'a', 'z', '한글']);
    expect(calculatePolicyFieldDiff(null, reversed)).toEqual(calculatePolicyFieldDiff(null, first));
  });

  it('중첩 객체와 배열 안 객체의 키 순서만 다르면 동일하게 판정한다', () => {
    expect(calculatePolicyFieldDiff(
      { extra: { z: [{ b: 2, a: { y: false, x: null } }], a: { 2: '둘', 10: '열' } } },
      { extra: { a: { 10: '열', 2: '둘' }, z: [{ a: { x: null, y: false }, b: 2 }] } },
    )).toEqual([]);
  });

  it.each<[JsonValue, JsonValue]>([
    ['본문', ' 본문 '], ['본문', '본문\n'], ['본문\r\n설명', '본문\n설명'],
    ['0', 0], [0, false], ['', null], [[], {}],
    [{ value: null }, {}], [{ value: '기존' }, { value: '변경' }],
    [[1, 2], [2, 1]], [[1, 2], [1]], [[1, 2], [1, 2, 2]],
    [[{ inqCnt: 1 }], [{ inqCnt: 2 }]], [{ inqCnt: 1 }, { inqCnt: 2 }],
  ])('공백과 자료형 및 중첩 내용 차이를 최상위 필드 하나로 보존한다: %#', (before, after) => {
    expect(calculatePolicyFieldDiff({ extra: before }, { extra: after })).toEqual([
      { key: 'extra', beforeExists: true, afterExists: true, before, after },
    ]);
  });

  it('최상위 조회수의 값 변경과 추가 및 삭제만 있으면 차이가 없다', () => {
    expect(calculatePolicyFieldDiff({ inqCnt: 1, title: '제목' }, { inqCnt: null, title: '제목' })).toEqual([]);
    expect(calculatePolicyFieldDiff({}, { inqCnt: 2 })).toEqual([]);
    expect(calculatePolicyFieldDiff({ inqCnt: 1 }, {})).toEqual([]);
  });

  it('프로토타입 속성을 필드로 오인하지 않고 특수 키를 일반 데이터로 비교한다', () => {
    const target = JSON.parse('{"__proto__":null,"constructor":"원본","toString":false}');
    expect(calculatePolicyFieldDiff({}, target)).toEqual([
      { key: '__proto__', beforeExists: false, afterExists: true, before: null, after: null },
      { key: 'constructor', beforeExists: false, afterExists: true, before: null, after: '원본' },
      { key: 'toString', beforeExists: false, afterExists: true, before: null, after: false },
    ]);
    const base = Object.assign(Object.create(null), target);
    expect(calculatePolicyFieldDiff(base, target)).toEqual([]);
    expect(calculatePolicyFieldDiff(target, {})).toEqual(
      calculatePolicyFieldDiff({}, target).map((diff) => ({
        ...diff, beforeExists: true, afterExists: false, before: diff.after, after: null,
      })),
    );
  });

  it('긴 원문과 미확인 필드를 자르지 않고 JSON 응답에서도 존재 여부를 보존한다', () => {
    const longText = '긴 원문\n'.repeat(5000);
    const diff = calculatePolicyFieldDiff({ unknown: null }, { unknown: longText, another: null });
    expect(JSON.parse(JSON.stringify(diff))).toEqual([
      { key: 'another', beforeExists: false, afterExists: true, before: null, after: null },
      { key: 'unknown', beforeExists: true, afterExists: true, before: null, after: longText },
    ]);
  });

  it('여러 JSON 값 조합에서 차이 유무가 기존 내용 해시의 동일 판정과 일치한다', () => {
    const values: Record<string, JsonValue>[] = [
      {}, { extra: null }, { extra: '' }, { extra: ' ' }, { extra: 0 }, { extra: false },
      { extra: [] }, { extra: {} }, { extra: [1, 2] }, { extra: [2, 1] },
      { extra: { b: 2, a: 1 } }, { extra: { a: 1, b: 2 } },
      { extra: { inqCnt: 1 } }, { extra: { inqCnt: 2 } }, { inqCnt: 1 }, { inqCnt: null },
    ];
    for (const before of values) {
      for (const after of values) {
        const base = { plcyNo: 'test', plcyNm: '제목', ...before };
        const target = { plcyNo: 'test', plcyNm: '제목', ...after };
        expect(calculatePolicyFieldDiff(base, target).length === 0)
          .toBe(createYouthCenterPolicyContentHash(base) === createYouthCenterPolicyContentHash(target));
      }
    }
  });

  it('동결된 입력의 키 순서와 중첩 객체 및 배열을 변경하지 않는다', () => {
    const beforeList = [2, 1];
    const afterList = [1, 2];
    Object.freeze(beforeList);
    Object.freeze(afterList);
    const base = Object.freeze({ z: Object.freeze({ b: 2, a: 1 }), a: beforeList });
    const target = Object.freeze({ z: Object.freeze({ b: 3, a: 1 }), a: afterList });
    const originalBase = structuredClone(base);
    const originalTarget = structuredClone(target);
    const result: PolicyFieldDiff[] = calculatePolicyFieldDiff(base, target);
    expect(result.map(({ key }) => key)).toEqual(['a', 'z']);
    expect(base).toEqual(originalBase);
    expect(target).toEqual(originalTarget);
    expect(Object.keys(base.z)).toEqual(['b', 'a']);
    expect(Object.keys(target)).toEqual(['z', 'a']);
  });
});
