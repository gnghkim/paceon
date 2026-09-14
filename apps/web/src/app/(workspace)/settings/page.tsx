import { YouTubeConnection } from '@/components/youtube-connection';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">설정</h1>
      </header>
      <section aria-labelledby="accounts-title" className="space-y-3">
        <h2 id="accounts-title" className="font-semibold">연결된 계정</h2>
        <YouTubeConnection />
      </section>
    </div>
  );
}
