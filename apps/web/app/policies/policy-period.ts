/** 명확한 날짜·단일 범위만 구분점을 넣고, 설명이나 해석 불가 기간은 원문을 유지한다. */
export function formatApplicationPeriod(text: string): string {
  const value = text.trim();
  const range = /^(\d{8}|\d{4}-\d{2}-\d{2})\s*~\s*(\d{8}|\d{4}-\d{2}-\d{2})$/.exec(value);
  const dates = range ? range.slice(1) : [value];
  const formatted = dates.map((date) => {
    if (!/^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(date)) return null;
    const digits = date.replaceAll('-', '');
    const year = digits.slice(0, 4), month = digits.slice(4, 6), day = digits.slice(6, 8);
    const iso = `${year}-${month}-${day}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    // 2월 30일처럼 자동 보정될 수 있는 날짜도 실제 연·월·일과 비교해 그대로 남긴다.
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== Number(year)
      || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return null;
    return { iso, label: `${year}.${month}.${day}` };
  });
  if (formatted.some((date) => date === null)) return text;
  const start = formatted[0]!;
  const end = formatted[1];
  if (end && start.iso > end.iso) return text;
  return end ? `${start.label} ~ ${end.label}` : start.label;
}

