import type { Policy } from '../entities/policy.entity';

/** 수집 변환과 검수 승인의 공개 저장에 사용할 정책 값 */
export type PolicyWriteInput = Omit<Policy, 'id' | 'createdAt' | 'updatedAt' | 'sourceRegisteredAt' | 'sourceModifiedAt'> & {
  // 원본의 시간대 없는 시각은 문자열로 전달
  sourceRegisteredAt: string | null;
  sourceModifiedAt: string | null;
};

