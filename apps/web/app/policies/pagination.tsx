/** 현재 페이지 주변 최대 5개와 처음·이전·다음·끝 이동을 표시한다. */
export function Pagination({ page, totalPages, onChange }: {
  page: number; totalPages: number; onChange: (page: number) => void;
}) {
  if (totalPages === 0) return null;
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  return (
    <nav className="pagination" aria-label="정책 목록 페이지">
      <button type="button" disabled={page <= 1} onClick={() => onChange(1)}>처음</button>
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>이전</button>
      {pages.map((number) => <button type="button" key={number} aria-label={`${number}페이지`}
        aria-current={number === page ? 'page' : undefined} disabled={number === page}
        onClick={() => onChange(number)}>{number}</button>)}
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>다음</button>
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(totalPages)}>마지막</button>
    </nav>
  );
}
