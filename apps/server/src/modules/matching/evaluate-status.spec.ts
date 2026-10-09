import type { PolicyConditions, UserStatus } from '@kkultong/contracts';
import { evaluateStatus } from './evaluate-status';

function rule(statuses: UserStatus[]): PolicyConditions['status'] {
  return { kind: 'RULE', value: statuses } as PolicyConditions['status'];
}

describe('evaluateStatus', () => {
  it('상태를 입력하지 않으면 NOT_PROVIDED를 반환한다', () => {
    expect(evaluateStatus(rule(['STUDENT']), {})).toBe('NOT_PROVIDED');
  });

  it('ANY 조건은 MATCH를 반환한다', () => {
    expect(evaluateStatus({ kind: 'ANY' }, { statuses: ['STUDENT'] })).toBe('MATCH');
  });

  it('UNKNOWN 조건은 POLICY_UNKNOWN을 반환한다', () => {
    expect(evaluateStatus({ kind: 'UNKNOWN' }, { statuses: ['STUDENT'] })).toBe('POLICY_UNKNOWN');
  });

  it('허용 상태와 하나라도 겹치면 MATCH를 반환한다', () => {
    expect(evaluateStatus(rule(['STUDENT']), { statuses: ['EMPLOYEE', 'STUDENT'] })).toBe('MATCH');
  });

  it('허용 상태와 전혀 겹치지 않으면 MISMATCH를 반환한다', () => {
    expect(evaluateStatus(rule(['STUDENT']), { statuses: ['EMPLOYEE'] })).toBe('MISMATCH');
  });
});
