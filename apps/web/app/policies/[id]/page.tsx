import { PolicyDetail } from '../../../components/policy/PolicyDetail';

interface PolicyDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PolicyDetailPage({ params }: PolicyDetailPageProps): Promise<React.ReactElement> {
  const { id } = await params;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-10 sm:px-8 sm:py-12">
      <PolicyDetail policyId={id} />
    </main>
  );
}
