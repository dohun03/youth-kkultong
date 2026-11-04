import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminReviewIdSchema } from '@youth-kkultong/shared';

/** 선택한 검수 UUID의 상세 경로와 목록 복귀를 제공하는 보호 화면의 기본 틀 */
export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!adminReviewIdSchema.safeParse(id).success) notFound();
  return <section className="admin-panel">
    <Link className="admin-detail-back" href="/admin/reviews">← 검수 대기 목록으로</Link>
    <h2>검수 상세</h2><p className="admin-review-id">검수 ID: {id}</p>
    <p className="admin-description">정책 변경 내용 비교와 승인 및 거절 화면을 준비하고 있습니다.</p>
  </section>;
}
