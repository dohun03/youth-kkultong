/** 현재 페이지 주변 최대 5개와 처음·이전·다음·끝 이동을 표시한다. */
export function Pagination({ page, totalPages, onChange, busy = false }: {
  busy?: boolean; page: number; totalPages: number; onChange: (page: number) => void;
}) {
  if (totalPages === 0) return null;
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  return (
    <nav className="pagination" aria-label="정책 목록 페이지">
      <button className="pagination-edge" type="button" aria-label="처음" disabled={busy || page <= 1} onClick={() => onChange(1)}><span aria-hidden="true">«</span></button>
      <button type="button" disabled={busy || page <= 1} aria-label="이전" onClick={() => onChange(page - 1)}><span aria-hidden="true">‹</span></button>
      {pages.map((number) => <button type="button" key={number} aria-label={`${number}페이지`}
        aria-current={number === page ? 'page' : undefined} disabled={busy || number === page}
        onClick={() => onChange(number)}>{number}</button>)}
      <button type="button" disabled={busy || page >= totalPages} aria-label="다음" onClick={() => onChange(page + 1)}><span aria-hidden="true">›</span></button>
      <button className="pagination-edge" type="button" aria-label="마지막" disabled={busy || page >= totalPages} onClick={() => onChange(totalPages)}><span aria-hidden="true">»</span></button>
    </nav>
  );
}
