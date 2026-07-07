'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Gauge, History, Loader2, Save, ShieldAlert, ShieldCheck, Sparkles, TerminalSquare, Zap } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/empty-state';
import Input from '@/components/ui/Input';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, Reveal, Stagger, StaggerItem } from '@/components/motion';

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
    riskFactors: string[];
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
  logs: AnalyzerDebugLog[];
  analyzedAt: string;
}

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

// Scam-detection verdict derived from the on-chain risk score.
// Lower score = safer. This is the primary output users care about:
// is this project a scam or legit?
function getSecurityVerdict(riskScore: number) {
  if (riskScore <= 25) {
    return {
      label: 'Likely Legitimate',
      description: 'On-chain signals look healthy. Low scam probability.',
      icon: ShieldCheck,
      iconClass: 'text-success',
      className: 'border-success/20 bg-emerald-50 text-success',
    };
  }
  if (riskScore <= 50) {
    return {
      label: 'Proceed with Caution',
      description: 'Some risk signals present. Verify before minting.',
      icon: AlertTriangle,
      iconClass: 'text-warning',
      className: 'border-warning/20 bg-amber-50 text-warning',
    };
  }
  if (riskScore <= 75) {
    return {
      label: 'High Risk',
      description: 'Multiple risk signals detected. Minting is risky.',
      icon: ShieldAlert,
      iconClass: 'text-orange-400',
      className: 'border-orange-500/25 bg-orange-500/10 text-orange-400',
    };
  }
  return {
    label: 'Likely Scam',
    description: 'Strong scam indicators found. Do not mint.',
    icon: ShieldAlert,
    iconClass: 'text-danger',
    className: 'border-danger/20 bg-red-50 text-danger',
  };
}

function LiveDebugConsole({ logs }: { logs: AnalyzerDebugLog[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  const levelClass: Record<AnalyzerDebugLog['level'], string> = {
    info: 'text-sky-300',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
  };

  return (
    <Card className="overflow-hidden border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <span className="flex items-center gap-3">
          <TerminalSquare className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="font-semibold text-text">Live Debug Console</span>
        </span>
        <Badge variant={logs.some((log) => log.level === 'error') ? 'danger' : logs.length > 0 ? 'info' : 'default'}>
          {logs.length} logs
        </Badge>
      </div>
      <div
        ref={scrollRef}
        className="h-[30rem] overflow-y-auto bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-400"
        aria-live="polite"
      >
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="whitespace-pre-wrap break-words">
              <span className="text-slate-500">[{formatLogTime(log.timestamp)}]</span>{' '}
              <span className={levelClass[log.level]}>{log.message}</span>
            </div>
          ))
        ) : (
          <div className="text-slate-500">Logs stream here during analysis.</div>
        )}
      </div>
    </Card>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-surface-hover p-3">
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

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

type AnalyzerHistoryItem = {
  id: string;
  input: string;
  sourceUrl: string | null;
  collectionName: string | null;
  contractAddress: string | null;
  chain: string | null;
  riskScore: number | null;
  riskLevel: string | null;
  createdAt: string;
};

function riskBadgeVariant(level?: string | null): BadgeVariant {
  if (level === 'Low') return 'success';
  if (level === 'Medium') return 'info';
  if (level === 'High') return 'warning';
  if (level === 'Critical') return 'danger';
  return 'default';
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Quick-access list of this user's last few analyses, pulled from the same
 * /api/analyzer/history endpoint that powers the full History > Analyzer
 * tab. Clicking an entry re-populates the Mint URL field so you can rerun
 * or pick back up where you left off without retyping the URL. */
function RecentAnalyses({ onSelect }: { onSelect: (input: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analyzer-history-recent'],
    queryFn: async (): Promise<AnalyzerHistoryItem[]> => {
      const res = await fetch('/api/analyzer/history?limit=5');
      if (!res.ok) throw new Error('Failed to load analyzer history');
      const body = (await res.json()) as { items: AnalyzerHistoryItem[] };
      return body.items;
    },
    staleTime: 15_000,
  });

  const items = data ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-semibold text-text">Recent Analyses</h2>
        </div>
        <Link href="/history?tab=analyzer" className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors">
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No analyses yet — run one above and it will show up here.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.sourceUrl || item.contractAddress || item.input)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-hover px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">
                  {item.collectionName || (item.contractAddress ? `${item.contractAddress.slice(0, 6)}\u2026${item.contractAddress.slice(-4)}` : item.input)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {formatRelativeTime(item.createdAt)}
                </p>
              </div>
              {item.riskLevel && (
                <Badge variant={riskBadgeVariant(item.riskLevel)} className="shrink-0">
                  {item.riskLevel}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AnalyzerClient({ initialInput = '' }: { initialInput?: string }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(initialInput);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AnalyzerDebugLog[]>([]);
  const [saved, setSaved] = useState(false);
  const scores = useMemo(() => deriveScores(result), [result]);
  const verdict = getSecurityVerdict(result?.riskAnalysis?.riskScore ?? 0);

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
        body: JSON.stringify({ input, depth: 'full' }),
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
            // Refresh the Recent Analyses list so this run shows up immediately.
            void queryClient.invalidateQueries({ queryKey: ['analyzer-history-recent'] });
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

  // ── Direct instant-mint (bypasses AI interpreter entirely) ─────────────────
  const [isMinting, setIsMinting] = useState(false);
  const [mintResult, setMintResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleInstantMint = async () => {
    if (!result || isMinting) return;
    setIsMinting(true);
    setMintResult(null);
    try {
      const res = await fetch('/api/mints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mintUrl: result.intent.sourceUrl,
          quantity: 1,
        }),
      });
      const data = await res.json() as { taskId?: string; action?: string; error?: string };
      if (!res.ok || data.error) {
        setMintResult({ success: false, message: data.error ?? 'Mint failed — check the Mints page.' });
      } else {
        setMintResult({
          success: true,
          message: data.action === 'executed'
            ? '✅ Mint executed! Check the Mints page for the result.'
            : '✅ Mint queued! Monitoring for the live window.',
        });
        queryClient.invalidateQueries({ queryKey: ['mints'] });
      }
    } catch {
      setMintResult({ success: false, message: 'Network error — please try again.' });
    } finally {
      setIsMinting(false);
    }
  };

  const openMints = () => {
    if (url.trim()) {
      window.location.href = `/mints?mintUrl=${encodeURIComponent(url.trim())}`;
    } else {
      window.location.href = '/mints';
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Scam Detection"
        title="Analyzer"
        description="Paste a URL or contract address to check whether an NFT project is a scam or legitimate — on-chain security, contract analysis, and risk scoring."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="space-y-6 min-w-0">
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
            <div className="space-y-2">
              <Button type="submit" className="w-full" loading={analyzing}>
                <Gauge className="h-4 w-4" aria-hidden="true" />
                Analyze
              </Button>
              <Button variant="ghost" size="sm" type="button" className="w-full" onClick={openMints}>
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                Skip to Queue Mint
              </Button>
            </div>
            {error ? (
              <div className="rounded-lg border border-danger/20 bg-red-50 p-3 text-sm text-danger" role="alert">
                {error}
              </div>
            ) : null}
          </form>
        </Card>

        <Stagger className="grid gap-4 md:grid-cols-3" inView>
          <StaggerItem><MetricCard label="Opportunity Score" value={result ? String(scores.opportunity) : '--'} detail={result ? 'Collection opportunity' : 'Awaiting analysis'} icon={Sparkles} tone="accent" /></StaggerItem>
          <StaggerItem><MetricCard label="Risk Score" value={result ? String(scores.risk) : '--'} detail={result ? riskLabel(result.riskAnalysis.riskLevel) : 'Awaiting analysis'} icon={AlertTriangle} tone="warning" /></StaggerItem>
          <StaggerItem><MetricCard label="Readiness" value={result ? `${scores.readiness}%` : '--'} detail={result ? result.mintFunction.functionName : 'Execution plan pending'} icon={CheckCircle2} tone="success" /></StaggerItem>
        </Stagger>

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
            <Reveal>
            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
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
            </Reveal>

            <Reveal>
            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <verdict.icon className={`h-5 w-5 ${verdict.iconClass}`} aria-hidden="true" />
                <h2 className="font-semibold text-text">Security Verdict</h2>
              </div>

              <div className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${verdict.className}`}>
                <div className="flex items-center gap-3">
                  <verdict.icon className="h-7 w-7 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-lg font-semibold">{verdict.label}</p>
                    <p className="text-sm opacity-80">{verdict.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-3xl font-bold">{result.riskAnalysis.riskScore}</p>
                  <p className="text-xs uppercase opacity-70">Risk / 100</p>
                </div>
              </div>

              {result.riskAnalysis.riskFactors && result.riskAnalysis.riskFactors.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs uppercase text-muted">
                    Risk factors detected ({result.riskAnalysis.riskFactors.length})
                  </p>
                  <ul className="space-y-2">
                    {result.riskAnalysis.riskFactors.map((factor, index) => (
                      <motion.li
                        key={`${factor}-${index}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(index, 10) * 0.04, duration: 0.25 }}
                        className="flex items-start gap-2 rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                        <span>{factor}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/20 bg-emerald-50 px-3 py-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>No on-chain risk factors detected.</span>
                </div>
              )}
            </Card>
            </Reveal>

            <Reveal>
            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                {result?.mintState.status === 'LIVE'
                  ? <Zap className="h-5 w-5 text-success" aria-hidden="true" />
                  : <Save className="h-5 w-5 text-primary" aria-hidden="true" />
                }
                <h2 className="font-semibold text-text">
                  {result?.mintState.status === 'LIVE' ? 'Live Mint' : 'Actions'}
                </h2>
                {result?.mintState.status === 'LIVE' && (
                  <span className="ml-auto flex items-center gap-1.5 rounded-full border border-success/30 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-0.5 text-xs font-semibold text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    LIVE NOW
                  </span>
                )}
              </div>

              {/* ── LIVE: Instant mint banner ─────────────────────────────── */}
              {result?.mintState.status === 'LIVE' ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-success/20 bg-emerald-50 dark:bg-emerald-950/20 p-4">
                    <p className="text-sm font-medium text-success mb-1">
                      This collection is minting right now.
                    </p>
                    <p className="text-xs text-muted">
                      Clicking Mint Now calls <code className="font-mono">/api/mints</code> directly
                      — no AI, no queue, instant execution.
                    </p>
                  </div>

                  <Button
                    type="button"
                    className="w-full"
                    disabled={isMinting}
                    onClick={() => void handleInstantMint()}
                  >
                    {isMinting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Minting…</>
                      : <><Zap className="h-4 w-4" /> Mint Now</>
                    }
                  </Button>

                  {mintResult && (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                      mintResult.success
                        ? 'border-success/20 bg-emerald-50 dark:bg-emerald-950/20 text-success'
                        : 'border-danger/20 bg-red-50 dark:bg-red-950/20 text-danger'
                    }`}>
                      {mintResult.success
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      }
                      <span>{mintResult.message}</span>
                    </div>
                  )}

                  <Button type="button" variant="secondary" className="w-full" onClick={openMints}>
                    <Gauge className="h-4 w-4" aria-hidden="true" />
                    Advanced Mint Options
                  </Button>
                </div>
              ) : (
                /* ── NOT LIVE: Standard actions ──────────────────────────── */
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
              )}
            </Card>
            </Reveal>
          </div>
        ) : (
          <EmptyState
            image="/illustrations/analyzer-pre-paste.jpeg"
            imageAlt="A small character holding a magnifying glass to a blank sheet of paper with a floating question mark."
            title="Ready to analyze"
            description="Paste a mint URL, explorer URL, OpenSea collection URL, or direct contract address. AutoMint checks the contract, gas, and rug/honeypot signals in seconds."
          />
        )}
      </div>

      <div className="space-y-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        <LiveDebugConsole logs={logs} />
        <RecentAnalyses onSelect={(input) => { setUrl(input); setError(null); }} />
      </div>
      </div>
    </div>
  );
}
