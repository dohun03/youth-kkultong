import { SearchPanel } from '../components/search/SearchPanel';

export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-12 sm:px-8">
      <header className="mb-10 max-w-2xl">
        <p className="mb-3 text-sm font-semibold tracking-wide text-emerald-700">YOUTH POLICY GUIDE</p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">청년꿀통</h1>
        <p className="mt-4 text-lg leading-8 text-slate-600">
          지금 신청할 수 있는 청년 정책을 살펴보고, 나에게 필요한 지원을 찾아보세요.
        </p>
      </header>

      <SearchPanel />
    </main>
  );
}
