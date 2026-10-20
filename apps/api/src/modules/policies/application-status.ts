import type { ApplicationStatus } from '@youth-kkultong/shared';
import type { Policy } from './entities/policy.entity';

/** 수집 단계에서 정규화한 신청기간 정보만 받아 상태를 계산 */
export type ApplicationPeriod = Pick<Policy,
  'applicationPeriodCode' | 'applicationPeriodRaw' | 'applicationStartDate' | 'applicationEndDate'
>;

/** 전달받은 시각을 한국의 달력 날짜로 변경 */
export function getKoreaToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** 실제 존재하는 YYYY-MM-DD 날짜를 달력 일수로 바꾸며, 잘못된 날짜는 거부한다. */
function calendarDay(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return null;

  // 시각 차이가 아닌 날짜 차이를 구한다. 1~99년을 1900년대로 바꾸는 Date.UTC 보정도 피한다.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.getTime() / 86_400_000;
}

/** 기간 코드와 한국 오늘 날짜로 여섯 가지 신청 상태를 계산 */
export function calculateApplicationStatus(period: ApplicationPeriod, today: string): ApplicationStatus {
  // 소스에서 명시한 마감은 날짜 누락·역전·복수 기간보다 우선한다.
  if (period.applicationPeriodCode === '0057003') return 'CLOSED';

  const current = calendarDay(today);
  if (current === null) throw new RangeError('한국 오늘 날짜는 유효한 YYYY-MM-DD여야 합니다.');

  if (period.applicationPeriodCode === '0057002') {
    // 상시인데 날짜가 붙어 있거나 해석하지 못한 기간 원문이 있으면 상시로 단정하지 않는다.
    const raw = period.applicationPeriodRaw?.trim();
    return period.applicationStartDate === null && period.applicationEndDate === null
      && (!raw || raw === '상시') ? 'ALWAYS_OPEN' : 'UNKNOWN';
  }

  // 복수 기간·형식 오류는 수집 단계에서 양쪽 날짜가 NULL이 되므로 원문에서 일부 날짜를 추측하지 않는다.
  const start = calendarDay(period.applicationStartDate);
  const end = calendarDay(period.applicationEndDate);
  if (start === null || end === null || start > end) return 'UNKNOWN';

  // 코드가 없거나 미확인 코드여도 단일 유효 날짜가 있으면 SPEC의 날짜 기반 판정을 적용한다.
  if (current < start) return 'UPCOMING';
  if (current > end) return 'CLOSED';
  return end - current <= 7 ? 'CLOSING_SOON' : 'OPEN';
}
