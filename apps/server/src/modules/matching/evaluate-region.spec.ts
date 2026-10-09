import type { PolicyConditions } from '@kkultong/contracts';
import { evaluateRegion } from './evaluate-region';
import type { MatchContext } from './matching.types';

const CONTEXT: MatchContext = {
  today: new Date('2026-10-09T00:00:00.000Z'),
  medianIncomeByHouseholdSize: new Map(),
  regionParentByCode: new Map([
    ['11110', '11'],
    ['11140', '11'],
    ['26110', '26'],
  ]),
};

function rule(codes: string[]): PolicyConditions['region'] {
  return { kind: 'RULE', value: codes } as PolicyConditions['region'];
}

describe('evaluateRegion', () => {
  it('지역을 입력하지 않으면 정책 조건과 무관하게 NOT_PROVIDED를 반환한다', () => {
    expect(evaluateRegion({ kind: 'UNKNOWN' }, {}, CONTEXT)).toBe('NOT_PROVIDED');
  });

  it('전국 정책은 입력한 지역과 일치한다', () => {
    expect(evaluateRegion(rule(['KR']), { regionCode: '11' }, CONTEXT)).toBe('MATCH');
  });

  it('같은 시·도 정책은 시·도 또는 해당 시·군·구 입력과 일치한다', () => {
    expect(evaluateRegion(rule(['11']), { regionCode: '11' }, CONTEXT)).toBe('MATCH');
    expect(evaluateRegion(rule(['11']), { regionCode: '11110' }, CONTEXT)).toBe('MATCH');
  });

  it('다른 시·도 정책은 MISMATCH를 반환한다', () => {
    expect(evaluateRegion(rule(['11']), { regionCode: '26' }, CONTEXT)).toBe('MISMATCH');
  });

  it('같은 시·도의 특정 시·군·구 정책은 시·도 입력만으로 확정하지 않는다', () => {
    expect(evaluateRegion(rule(['11110']), { regionCode: '11' }, CONTEXT)).toBe('NOT_PROVIDED');
  });

  it('서로 다른 부모 시·도의 시·군·구는 MISMATCH를 반환한다', () => {
    expect(evaluateRegion(rule(['11110']), { regionCode: '26110' }, CONTEXT)).toBe('MISMATCH');
  });

  it('시·군·구까지 입력하면 동일 코드만 MATCH 처리한다', () => {
    expect(evaluateRegion(rule(['11110']), { regionCode: '11110' }, CONTEXT)).toBe('MATCH');
    expect(evaluateRegion(rule(['11110']), { regionCode: '11140' }, CONTEXT)).toBe('MISMATCH');
  });

  it('부모 시·도를 알 수 없는 시·군·구 코드는 안전하게 POLICY_UNKNOWN으로 처리한다', () => {
    expect(evaluateRegion(rule(['99999']), { regionCode: '11' }, CONTEXT)).toBe('POLICY_UNKNOWN');
  });
});
