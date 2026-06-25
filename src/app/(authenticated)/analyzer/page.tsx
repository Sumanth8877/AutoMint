import AnalyzerClient from './analyzer-client';

// Cache this page for 30 seconds (has dynamic searchParams)
export const revalidate = 30;

export default async function AnalyzerPage({
  searchParams,
}: {
  searchParams: Promise<{ input?: string }>;
}) {
  const params = await searchParams;
  return <AnalyzerClient initialInput={params.input ?? ''} />;
}
