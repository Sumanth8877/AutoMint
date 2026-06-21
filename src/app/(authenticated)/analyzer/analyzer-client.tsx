'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clipboard, ExternalLink, Gauge, Save, Sparkles, TerminalSquare } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/empty-state';
import Input from '@/components/ui/Input';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

type AnalyzerDebugLog = {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  stage: string;
  message: string;
};

interface AnalyzerResponse {
  intent: {
    sourceUrl: string;
    contractAddress?: string;
    chain: string;
    collectionName?: string;
    collectionSlug?: string;
    confidence: number;
  };
  metadata: {
    name: string;
    totalSupply: string;
    tokenStandard: string;
  };
  mintState: {
    status: string;
  };
  mintFunction: {
    functionName: string;
    confidence: number;
  };
  riskAnalysis: {
    riskScore: number;
    riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  };
  collectionIntelligence: {
    collectionName: string;
    description: string | null;
    chain: string;
    tokenStandard: string;
    floorPrice: string | null;
    floorCurrency: string | null;
    floorSymbol: string | null;
    ownerCount: number | null;
    itemCount: number | null;
  };
  socials: {
    website?: string;
    twitter?: string;
    discord?: string;
    telegram?: string;
  };
  logs: AnalyzerDebugLog[];
  analyzedAt: string;
}

const SOCIAL_KEYS = ['website', 'twitter', 'discord', 'telegram'] as const;

function formatNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString();
}

function formatMetric(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  return typeof value === 'number' ? value.toLocaleString() : value;
}

function formatLogTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

function formatSocialLabel(value: string) {
  return value === 'twitter' ? 'Twitter' : value.charAt(0).toUpperCase() + value.slice(1);
}

function displayCollectionName(result: AnalyzerResponse) {
  return result.collectionIntelligence.collectionName
    || result.intent.collectionName
    || result.metadata.name
    || result.intent.collectionSlug
    || 'Resolved Collection';
}

function displaySupply(result: AnalyzerResponse) {
  return formatNumber(result.collectionIntelligence.itemCount ?? result.metadata.totalSupply);
}

function displayTokenStandard(result: AnalyzerResponse) {
  return result.collectionIntelligence.tokenStandard || result.metadata.tokenStandard || 'Unavailable';
}

function displayFloorPrice(result: AnalyzerResponse) {
  const price = result.collectionIntelligence.floorPrice;
  if (!price) return 'Unavailable';
  const symbol = result.collectionIntelligence.floorSymbol ?? result.collectionIntelligence.floorCurrency;
  if (!symbol || price.toLowerCase().includes(symbol.toLowerCase())) return price;
  return `${price} ${symbol}`;
}

function deriveScores(result: AnalyzerResponse | null) {
  if (!result) return { opportunity: 0, risk: 0, readiness: 0 };

  const confidence = Math.round(result.intent.confidence * 100);
  const functionConfidence = Math.round(result.mintFunction.confidence * 100);
  const liveBonus = result.mintState.status === 'LIVE' ? 12 : 0;
  const readiness = Math.min(96, Math.max(24, Math.round((confidence + functionConfidence) / 2) + liveBonus));
  const risk = result.riskAnalysis.riskScore;
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));

  return { opportunity: Math.round(opportunity), risk, readiness };
}

function riskLabel(level: AnalyzerResponse['riskAnalysis']['riskLevel']) {
  return level === 'Critical' ? 'High' : level;
}

function LiveDebugConsole({ logs }: { logs: AnalyzerDebugLog[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  const levelClass: Record<AnalyzerDebugLog['level'], string> = {
    info: 'text-sky-200',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-danger',
  };

  return (
    <Card className="overflow-hidden border-accent/20 bg-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <span className="flex items-center gap-3">
          <TerminalSquare className="h-5 w-5 text-accent" aria-hidden="true" />
          <span className="font-semibold text-text">Live Debug Console</span>
        </span>
        <Badge variant={logs.some((log) => log.level === 'error') ? 'danger' : logs.length > 0 ? 'info' : 'default'}>
          {logs.length} logs
        </Badge>
      </div>
      <div
        ref={scrollRef}
        className="max-h-80 overflow-y-auto bg-[#05070d] p-4 font-mono text-xs leading-6 text-muted"
        aria-live="polite"
      >
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="whitespace-pre-wrap break-words">
              <span className="text-muted/80">[{formatLogTime(log.timestamp)}]</span>{' '}
              <span className={levelClass[log.level]}>{log.message}</span>
            </div>
          ))
        ) : (
          <div className="text-muted">Logs stream here during analysis.</div>
        )}
      </div>
    </Card>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-white/5 p-3">
          <p className="text-xs uppercase text-muted">{label}</p>
          <p className="mt-1 break-words text-sm font-medium text-text">{value}</p>
        </div>
      ))}
    </div>
  );
}

function parseSseEvents(buffer: string) {
  const chunks = buffer.split('\n\n');
  return { events: chunks.slice(0, -1), remainder: chunks.at(-1) ?? '' };
}

function readSseEvent(raw: string) {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  return { event, data: JSON.parse(dataLines.join('\n')) as unknown };
}

export default function AnalyzerClient({ initialInput = '' }: { initialInput?: string }) {
  const [url, setUrl] = useState(initialInput);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AnalyzerDebugLog[]>([]);
  const [saved, setSaved] = useState(false);
  const scores = useMemo(() => deriveScores(result), [result]);

  const analyze = async () => {
    const input = url.trim();
    if (!input) {
      setError('Paste a launchpad URL, explorer URL, or contract address first.');
      setResult(null);
      return;
    }

    setAnalyzing(true);
    setError(null);
    setResult(null);
    setSaved(false);
    setLogs([]);

    try {
      const response = await fetch('/api/analyzer/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Analyzer request failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;

        for (const raw of parsed.events) {
          const { event, data } = readSseEvent(raw);
          if (event === 'log') {
            setLogs((current) => [...current, data as AnalyzerDebugLog]);
          }
          if (event === 'result') {
            const analyzerResult = data as AnalyzerResponse;
            setResult(analyzerResult);
            setLogs(analyzerResult.logs ?? []);
            setSaved(true);
          }
          if (event === 'error') {
            const payload = data as { error?: string; logs?: AnalyzerDebugLog[] };
            if (payload.logs?.length) setLogs(payload.logs);
            throw new Error(payload.error ?? 'Analyzer request failed.');
          }
        }
      }
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : 'Analyzer request failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      setError(null);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  };

  const openMints = () => {
    window.location.href = '/mints';
  };

  return (
    <div>
      <PageHeader
        eyebrow="Flagship Analyzer"
        title="Analyzer"
        description="Resolve NFT collection intelligence, risk, readiness, scheduling signals, and mint execution inputs."
        actions={
          <Button onClick={analyze} loading={analyzing}>
            Analyze
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      />

      <div className="space-y-6">
        <Card tone="elevated" className="p-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void analyze();
            }}
          >
            <Input
              label="Mint URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://opensea.io/collection/..."
              aria-invalid={Boolean(error)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" type="button" onClick={pasteUrl}>
                <Clipboard className="h-4 w-4" aria-hidden="true" />
                Paste
              </Button>
              <Button type="submit" loading={analyzing}>
                <Gauge className="h-4 w-4" aria-hidden="true" />
                Analyze
              </Button>
            </div>
            {error ? (
              <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">
                {error}
              </div>
            ) : null}
          </form>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Opportunity Score" value={result ? String(scores.opportunity) : '--'} detail={result ? 'Collection opportunity' : 'Awaiting analysis'} icon={Sparkles} tone="accent" />
          <MetricCard label="Risk Score" value={result ? String(scores.risk) : '--'} detail={result ? riskLabel(result.riskAnalysis.riskLevel) : 'Awaiting analysis'} icon={AlertTriangle} tone="warning" />
          <MetricCard label="Readiness" value={result ? `${scores.readiness}%` : '--'} detail={result ? result.mintFunction.functionName : 'Execution plan pending'} icon={CheckCircle2} tone="success" />
        </div>

        {analyzing && !result ? (
          <Card className="p-5">
            <Skeleton className="h-5 w-48" />
            <div className="mt-5 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </Card>
        ) : result ? (
          <div className="space-y-6">
            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-text">Collection Overview</h2>
              </div>
              <DetailGrid rows={[
                ['Collection Name', displayCollectionName(result)],
                ['Chain', result.collectionIntelligence.chain || result.intent.chain],
                ['Supply', displaySupply(result)],
                ['Token Standard', displayTokenStandard(result)],
                ['Owner Count', formatMetric(result.collectionIntelligence.ownerCount)],
                ['Floor Price', displayFloorPrice(result)],
              ]} />
              {result.collectionIntelligence.description ? (
                <p className="mt-4 text-sm leading-6 text-muted">{result.collectionIntelligence.description}</p>
              ) : null}
            </Card>

            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <ExternalLink className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-text">Social Discovery</h2>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {SOCIAL_KEYS.map((key) => {
                  const value = result.socials[key];
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-white/5 px-3 py-2 text-sm">
                      <span className="text-muted">{formatSocialLabel(key)}</span>
                      {value ? (
                        <a
                          href={value}
                          target="_blank"
                          rel="noreferrer"
                          className="max-w-[65%] truncate text-right font-medium text-accent hover:text-accent/80"
                        >
                          {value}
                        </a>
                      ) : (
                        <span className="text-warning">Not found</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Save className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-text">Actions</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={!saved}>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {saved ? 'Analysis Saved' : 'Save Analysis'}
                </Button>
                <Button type="button" onClick={openMints}>
                  <Gauge className="h-4 w-4" aria-hidden="true" />
                  Create Scheduled Mint
                </Button>
              </div>
            </Card>
          </div>
        ) : (
          <EmptyState
            icon={Gauge}
            title="Ready to analyze"
            description="Paste an explorer URL, OpenSea collection URL, or direct contract address to resolve NFT intelligence and execution readiness."
          />
        )}

        <LiveDebugConsole logs={logs} />
      </div>
    </div>
  );
}
