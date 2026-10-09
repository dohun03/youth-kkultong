import type { PolicyConditions } from '@kkultong/contracts';
import { evaluateHousehold } from './evaluate-household';

function rule(min: number | null, max: number | null): PolicyConditions['householdSize'] {
  return { kind: 'RULE', value: { min, max } } as PolicyConditions['householdSize'];
}

describe('evaluateHousehold', () => {
  it('가구원 수를 입력하지 않으면 NOT_PROVIDED를 반환한다', () => {
    expect(evaluateHousehold({ kind: 'ANY' }, {})).toBe('NOT_PROVIDED');
  });

  it('ANY 조건은 입력한 가구원 수와 일치한다', () => {
    expect(evaluateHousehold({ kind: 'ANY' }, { householdSize: 2 })).toBe('MATCH');
  });

  it('UNKNOWN 조건은 POLICY_UNKNOWN을 반환한다', () => {
    expect(evaluateHousehold({ kind: 'UNKNOWN' }, { householdSize: 2 })).toBe('POLICY_UNKNOWN');
  });

  it('RULE의 min·max 범위를 포함해 비교한다', () => {
    const condition = rule(2, 4);

    expect(evaluateHousehold(condition, { householdSize: 2 })).toBe('MATCH');
    expect(evaluateHousehold(condition, { householdSize: 4 })).toBe('MATCH');
    expect(evaluateHousehold(condition, { householdSize: 1 })).toBe('MISMATCH');
    expect(evaluateHousehold(condition, { householdSize: 5 })).toBe('MISMATCH');
  });
});
