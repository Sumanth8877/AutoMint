import AnalyzerClient from './analyzer-client';

export default async function AnalyzerPage({
  searchParams,
}: {
  searchParams: Promise<{ input?: string }>;
}) {
  const params = await searchParams;
  return <AnalyzerClient initialInput={params.input ?? ''} />;
}
