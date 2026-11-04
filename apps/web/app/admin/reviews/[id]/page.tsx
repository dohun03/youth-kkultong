import { notFound } from 'next/navigation';
import { adminReviewIdSchema } from '@youth-kkultong/shared';
import { ReviewDetail } from './review-detail';

/** 경로의 검수 UUID를 검사하고 인증된 상세 비교 화면으로 연결 */
export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!adminReviewIdSchema.safeParse(id).success) notFound();
  return <ReviewDetail key={id} id={id} />;
}
