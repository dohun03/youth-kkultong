export default function PoliciesPage() {
  return (
    <main className="container policies-page" id="main-content">
      <p className="eyebrow">내일을 위한 기회</p>
      <h1>청년 정책</h1>
      <p className="page-description">
        나에게 필요한 정책과 지원 정보를 찾아보세요.
      </p>
      <section className="empty-state" aria-labelledby="empty-title">
        <span className="empty-mark" aria-hidden="true" />
        <h2 id="empty-title">아직 등록된 정책이 없습니다</h2>
        <p>새로운 정책이 등록되면 이곳에서 확인할 수 있어요.</p>
      </section>
    </main>
  );
}
