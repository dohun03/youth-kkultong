import type { ApplicationStatus } from '@youth-kkultong/shared';

// API 코드와 사용자에게 보여줄 문구를 분리하고, 빠진 상태가 있으면 타입 검사에서 찾는다.
export const statusLabels: Record<ApplicationStatus, string> = {
  ALWAYS_OPEN: '상시',
  UPCOMING: '접수 예정',
  OPEN: '신청 가능',
  CLOSING_SOON: '마감 임박',
  CLOSED: '마감',
  UNKNOWN: '확인 필요',
};

