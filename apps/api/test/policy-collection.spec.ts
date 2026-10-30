import { randomUUID } from 'node:crypto';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { classifyPolicyCollection } from '../src/modules/policies/policy-collection';
import type { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';

const source = 'youthcenter';

/** 실제 내용 해시를 계산해 비교에 사용할 직전 원본을 생성 */
function original(externalId: string, title = '직전 원본', overrides: Partial<SourcePolicy> = {}): SourcePolicy {
  const rawJson = { plcyNo: externalId, plcyNm: title, inqCnt: '10', nested: { values: [null, ' 원문 '] } };
  return {
    id: randomUUID(), source, externalId, title, rawJson,
    contentHash: createYouthCenterPolicyContentHash(rawJson), viewCount: 10,
    firstCollectedAt: new Date('2026-10-29T19:00:00Z'), lastCollectedAt: new Date('2026-10-29T19:00:00Z'),
    lastCollectionResult: 'UNCHANGED', missingCount: 0,
    createdAt: new Date('2026-10-28T00:00:00Z'), updatedAt: new Date('2026-10-29T19:00:00Z'), ...overrides,
  };
}

describe('정상 전체 수집과 직전 원본의 비교 판정', () => {
  it('기존 원본과 수집 응답이 모두 없으면 판정 건수는 모두 0이다', () => {
    expect(classifyPolicyCollection(source, [], [])).toEqual({
      collected: [], missing: [], counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 0 },
    });
  });

  it('처음 수집한 정책은 NEW이며 누락 횟수는 0이다', () => {
    const incoming = original('new');
    expect(classifyPolicyCollection(source, [], [incoming])).toEqual({
      collected: [{ source, externalId: 'new', lastCollectionResult: 'NEW', missingCount: 0 }],
      missing: [], counts: { NEW: 1, CHANGED: 0, UNCHANGED: 0, MISSING: 0 },
    });
  });

  it.each(['CHANGED', 'UNCHANGED'] as const)('직전 원본과 해시를 비교해 %s를 판정한다', (result) => {
    const previous = original('policy');
    const incoming = original('policy', result === 'CHANGED' ? '새 내용' : previous.title);
    const plan = classifyPolicyCollection(source, [previous], [incoming]);
    expect(plan.collected).toEqual([{ source, externalId: 'policy', lastCollectionResult: result, missingCount: 0 }]);
    expect(plan.counts).toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 0, [result]: 1 });
  });

  it('신규와 변경, 동일, 누락을 한 실행에서 구분하고 누락은 수집 건수와 별도로 센다', () => {
    const previous = [original('changed'), original('same'), original('missing')];
    const incoming = [original('new'), original('changed', '바뀐 원본'), original('same')];
    const plan = classifyPolicyCollection(source, previous, incoming);
    expect(plan.collected.map(({ lastCollectionResult }) => lastCollectionResult)).toEqual(['NEW', 'CHANGED', 'UNCHANGED']);
    expect(plan.missing).toEqual([{ id: previous[2].id, missingCount: 1 }]);
    expect(plan.counts).toEqual({ NEW: 1, CHANGED: 1, UNCHANGED: 1, MISSING: 1 });
    expect(plan.counts.NEW + plan.counts.CHANGED + plan.counts.UNCHANGED).toBe(incoming.length);
  });

  it.each(['99', '0', '', '해석 불가'])('최상위 조회수만 %s로 바뀌면 UNCHANGED로 판정한다', (views) => {
    const previous = original('views');
    const rawJson = { ...previous.rawJson, plcyNo: 'views', plcyNm: previous.title, inqCnt: views };
    const incoming = { ...previous, rawJson, contentHash: createYouthCenterPolicyContentHash(rawJson),
      viewCount: /^\d+$/.test(views) ? Number(views) : null };
    expect(classifyPolicyCollection(source, [previous], [incoming]).counts)
      .toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 1, MISSING: 0 });
  });

  it('중첩된 inqCnt 변경은 내용 해시에 포함되어 CHANGED로 판정한다', () => {
    const raw = { plcyNo: 'nested', plcyNm: '직전 원본', nested: { inqCnt: '10' } };
    const previous = original('nested', '직전 원본', { rawJson: raw, contentHash: createYouthCenterPolicyContentHash(raw) });
    const changedRaw = { ...raw, nested: { inqCnt: '20' } };
    const incoming = { ...previous, rawJson: changedRaw, contentHash: createYouthCenterPolicyContentHash(changedRaw) };
    expect(classifyPolicyCollection(source, [previous], [incoming]).collected[0].lastCollectionResult).toBe('CHANGED');
  });

  it('이관 후 아직 실제 수집하지 않은 원본도 같은 해시이면 UNCHANGED다', () => {
    const previous = original('migrated', '직전 원본', {
      firstCollectedAt: null, lastCollectedAt: null, lastCollectionResult: null,
    });
    expect(classifyPolicyCollection(source, [previous], [original('migrated')]).collected[0])
      .toEqual({ source, externalId: 'migrated', lastCollectionResult: 'UNCHANGED', missingCount: 0 });
    expect(previous.firstCollectedAt).toBeNull();
    expect(previous.lastCollectedAt).toBeNull();
  });

  it('공개 정책의 해시가 아닌 직전 수집 원본의 해시로 판정한다', () => {
    const publicVersion = original('policy', '공개 내용 A');
    const previous = original('policy', '미승인 원본 B');
    const incoming = original('policy', '미승인 원본 B');
    expect(incoming.contentHash).not.toBe(publicVersion.contentHash);
    expect(classifyPolicyCollection(source, [previous], [incoming]).collected[0].lastCollectionResult).toBe('UNCHANGED');
    expect(classifyPolicyCollection(source, [previous], [publicVersion]).collected[0].lastCollectionResult).toBe('CHANGED');
  });

  it('정상 전체 0건 응답이면 기존 원본을 모두 누락 처리한다', () => {
    const previous = [original('one'), original('two', '두 번째', { missingCount: 3 })];
    expect(classifyPolicyCollection(source, previous, [])).toEqual({
      collected: [], missing: [{ id: previous[0].id, missingCount: 1 }, { id: previous[1].id, missingCount: 4 }],
      counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 2 },
    });
  });

  it.each([[0, 1], [1, 2], [5, 6], [2147483646, 2147483647], [2147483647, 2147483647]])(
    '기존 누락 %s회에서 다음 정상 수집 후 %s회로 계산한다', (missingCount, expected) => {
      const previous = original('missing', '직전 원본', { missingCount });
      expect(classifyPolicyCollection(source, [previous], []).missing)
        .toEqual([{ id: previous.id, missingCount: expected }]);
    },
  );

  it('같은 날 성공한 전체 수집 두 번에서 빠지면 누락 횟수가 두 번 증가한다', () => {
    const previous = original('missing');
    const first = classifyPolicyCollection(source, [previous], []);
    const afterFirst = { ...previous, missingCount: first.missing[0].missingCount, lastCollectionResult: 'MISSING' as const };
    const second = classifyPolicyCollection(source, [afterFirst], []);
    expect(first.missing[0].missingCount).toBe(1);
    expect(second.missing[0].missingCount).toBe(2);
  });

  it.each(['CHANGED', 'UNCHANGED'] as const)('연속 누락 후 재등장하면 %s로 판정하고 누락을 0으로 초기화한다', (result) => {
    const previous = original('return', '직전 원본', { missingCount: 8, lastCollectionResult: 'MISSING' });
    const incoming = original('return', result === 'CHANGED' ? '재등장한 새 내용' : previous.title);
    const plan = classifyPolicyCollection(source, [previous], [incoming]);
    expect(plan.collected).toEqual([{ source, externalId: 'return', lastCollectionResult: result, missingCount: 0 }]);
    expect(plan.counts.NEW).toBe(0);
    expect(plan.missing).toEqual([]);
  });

  it('누락 최댓값인 원본도 다시 나타나면 0으로 초기화한다', () => {
    const previous = original('return', '직전 원본', { missingCount: 2147483647, lastCollectionResult: 'MISSING' });
    expect(classifyPolicyCollection(source, [previous], [original('return')]).collected[0].missingCount).toBe(0);
  });

  it('날짜나 마지막 관찰 시각 대신 이번 전체 응답의 포함 여부로 누락을 계산한다', () => {
    const sameDay = original('same-day');
    const oldDay = original('old-day', '직전 원본', { lastCollectedAt: new Date('2000-01-01T00:00:00Z') });
    const unseen = original('unseen', '직전 원본', { firstCollectedAt: null, lastCollectedAt: null });
    const plan = classifyPolicyCollection(source, [sameDay, oldDay, unseen], []);
    expect(plan.missing.map(({ missingCount }) => missingCount)).toEqual([1, 1, 1]);
    expect(sameDay.lastCollectedAt).toEqual(new Date('2026-10-29T19:00:00Z'));
    expect(oldDay.lastCollectedAt).toEqual(new Date('2000-01-01T00:00:00Z'));
    expect(unseen.lastCollectedAt).toBeNull();
  });

  it('누락 계산은 원문과 조회수, 실제 수집 시각을 포함한 입력 전체를 유지한다', () => {
    const previous = [original('missing')];
    const before = structuredClone(previous);
    Object.freeze(previous[0]);
    Object.freeze(previous);
    const first = classifyPolicyCollection(source, previous, []);
    // 실패한 저장 시도처럼 계산 결과를 반영하지 않고 재계산해도 기존 누락 횟수는 그대로 유지
    expect(classifyPolicyCollection(source, previous, [])).toEqual(first);
    expect(previous).toEqual(before);
    expect(previous[0].missingCount).toBe(0);
    expect(Object.keys(first.missing[0]).sort()).toEqual(['id', 'missingCount']);
  });

  it('수집된 입력과 직전 원본의 정렬 순서와 내용을 변경하지 않는다', () => {
    const previous = [original('z'), original('a')];
    const incoming = [original('z', '새 내용'), original('new'), original('a')];
    const before = structuredClone({ previous, incoming });
    for (const row of [...previous, ...incoming]) Object.freeze(row);
    Object.freeze(previous);
    Object.freeze(incoming);
    const plan = classifyPolicyCollection(source, previous, incoming);
    expect(plan.collected.map(({ externalId }) => externalId)).toEqual(['z', 'new', 'a']);
    expect({ previous, incoming }).toEqual(before);
  });

  it('배열 순서가 달라도 동일한 식별자로 원본을 찾아 비교한다', () => {
    const previous = [original('one'), original('two')];
    const plan = classifyPolicyCollection(source, previous, [original('two'), original('one', '새 내용')]);
    expect(plan.collected.map(({ lastCollectionResult }) => lastCollectionResult)).toEqual(['UNCHANGED', 'CHANGED']);
  });

  it('같은 외부 ID라도 서로 다른 출처의 수집 실행은 독립적으로 판정한다', () => {
    const first = original('same-id');
    const second = original('same-id', '다른 출처', { source: 'other' });
    expect(classifyPolicyCollection(source, [first], [first]).counts.UNCHANGED).toBe(1);
    expect(classifyPolicyCollection('other', [], [second]).counts.NEW).toBe(1);
  });

  it.each(['previous', 'incoming'] as const)('%s에 다른 출처가 섞이면 잘못된 누락 판정을 막기 위해 거부한다', (target) => {
    const other = original('policy', '직전 원본', { source: 'other' });
    expect(() => classifyPolicyCollection(source, target === 'previous' ? [other] : [], target === 'incoming' ? [other] : []))
      .toThrow('출처가 다릅니다');
  });

  it.each(['previous', 'incoming'] as const)('%s의 중복 외부 ID는 합산하지 않고 거부한다', (target) => {
    const one = original('duplicate');
    const two = original('duplicate', '다른 내용');
    expect(() => classifyPolicyCollection(source, target === 'previous' ? [one, two] : [], target === 'incoming' ? [one, two] : []))
      .toThrow('식별자가 중복');
  });

  it('빈 정상 응답에서도 출처가 다른 기존 원본은 비교 대상으로 허용하지 않는다', () => {
    expect(() => classifyPolicyCollection(source, [original('other', '다른 출처', { source: 'other' })], []))
      .toThrow('출처가 다릅니다');
  });

  it('특수문자가 포함된 외부 ID와 객체 속성 이름처럼 보이는 ID를 안전하게 구분한다', () => {
    const ids = ["id' OR 1=1 --", '__proto__', 'constructor', 'a|b', 'a'];
    const previous = ids.map((id) => original(id));
    const plan = classifyPolicyCollection(source, previous, ids.map((id) => original(id)));
    expect(plan.counts).toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: ids.length, MISSING: 0 });
    expect(plan.missing).toEqual([]);
  });

  it('대량 수집에서도 수신 건수와 누락 건수를 정확하게 분리한다', () => {
    const previous = Array.from({ length: 2000 }, (_, i) => original(`policy-${i}`));
    const incoming = Array.from({ length: 1500 }, (_, i) => original(`policy-${i + 1000}`));
    const plan = classifyPolicyCollection(source, previous, incoming);
    expect(plan.collected).toHaveLength(1500);
    expect(plan.missing).toHaveLength(1000);
    expect(plan.counts).toEqual({ NEW: 500, CHANGED: 0, UNCHANGED: 1000, MISSING: 1000 });
  });
});
