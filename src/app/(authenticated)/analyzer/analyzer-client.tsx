'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  ExternalLink,
  Gauge,
  LineChart,
  Radar,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/empty-state';
import Input from '@/components/ui/Input';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, apiRequest } from '@/lib/api/client';

interface AnalyzerResponse {
  intent: {
    sourceUrl: string;
    contractAddress?: string;
    chain: string;
    collectionName?: string;
    collectionSlug?: string;
    isValid: boolean;
    confidence: number;
    sourcePlatform: string;
  };
  metadata: {
    name: string;
    symbol: string;
    totalSupply: string;
    owner: string;
    tokenStandard: string;
  };
  mintState: {
    status: string;
    startTime?: string;
    endTime?: string;
    maxSupply?: number;
    minted?: number;
  };
  requirements: {
    mintFunction: string;
    mintPrice: string;
    maxPerWallet?: number;
    maxPerTx?: number;
  };
  mintFunction: {
    functionName: string;
    selector: string;
    confidence: number;
  };
  riskAnalysis: {
    riskScore: number;
    riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
    riskFactors: string[];
    riskSummary: string;
  };
  aiSummary: {
    summary: string;
    projectSummary: string;
    riskSummary: string;
    marketSummary: string;
    mintSummary: string;
  } | null;
  collectionIntelligence: {
    collectionName: string;
    description: string | null;
    creator: string | null;
    verified: boolean | null;
    contractAddress: string | null;
    chain: string;
    tokenStandard: string;
    floorPrice: string | null;
    volume: string | null;
    ownerCount: number | null;
    itemCount: number | null;
    marketCap: string | null;
    marketStatus: 'Hot' | 'Active' | 'Stable' | 'Declining' | 'Inactive';
    healthScore: number;
    healthSummary: string;
    sources: string[];
  };
  socials: {
    website?: string;
    twitter?: string;
    discord?: string;
    telegram?: string;
    github?: string;
    medium?: string;
  };
  socialHealth: {
    detectedCount: number;
    missing: Array<'website' | 'twitter' | 'discord' | 'telegram' | 'github' | 'medium'>;
  };
  providerChain: Array<{
    provider: string;
    status: 'success' | 'failed';
    durationMs: number;
  }>;
  providerUsed: string;
  cacheUsed: boolean;
  performanceMetrics: {
    cacheHitRate: number;
    averageAnalysisDurationMs: number;
    fastestProvider: string | null;
    slowestProvider: string | null;
  };
  rpcProviderUsed: string | null;
  rpcProviders: Array<{
    provider: string;
    selected: boolean;
    configured: boolean;
    healthy: boolean;
    latencyMs: number | null;
    status: string;
  }>;
  analysisDurationMs: number;
  timingBreakdown: Array<{
    stage: string;
    durationMs: number;
  }>;
  logs: AnalyzerDebugLog[];
  analyzedAt: string;
}

type AnalyzerDebugLog = {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  stage: string;
  message: string;
};

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

type AnalyzerObservability = {
  analyzerMetrics: {
    totalAnalyses: number;
    successfulAnalyses: number;
    failedAnalyses: number | null;
    successRate: number | null;
    averageAnalysisTimeMs: number | null;
  };
  serviceHealth: Array<{
    service: string;
    configured: boolean;
    healthy: boolean | null;
    lastSuccess: string | null;
    lastFailure: string | null;
    averageLatencyMs: number | null;
  }>;
  providerRates: Array<{
    provider: string;
    successPercent: number | null;
    failurePercent: number | null;
    successes: number;
    failures: number;
  }>;
  rpcMonitoring: {
    currentPrimaryProvider: string | null;
    currentLatencyMs: number | null;
    failoverCount: number;
    lastFailover: string | null;
  };
  recentErrors: Array<{
    service: string;
    message: string;
    createdAt: string;
  }>;
};

function formatNumber(value: string | number | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 'Unknown';
  return number.toLocaleString();
}

function formatMilliseconds(value: number) {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatOptionalMilliseconds(value: number | null) {
  return typeof value === 'number' ? formatMilliseconds(value) : 'Not tracked';
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'Not tracked';
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return 'Not tracked';
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatPercent(value: number | null) {
  return typeof value === 'number' ? `${value}%` : 'Not tracked';
}

function formatMetric(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

function formatVerified(value: boolean | null) {
  if (value === null) return 'Unavailable';
  return value ? 'Verified' : 'Unverified';
}

function confidenceLabel(value: number) {
  if (value >= 0.85) return 'High';
  if (value >= 0.55) return 'Medium';
  return 'Low';
}

function deriveScores(result: AnalyzerResponse | null) {
  if (!result) {
    return { opportunity: 0, risk: 0, readiness: 0 };
  }

  const confidence = Math.round(result.intent.confidence * 100);
  const functionConfidence = Math.round(result.mintFunction.confidence * 100);
  const liveBonus = result.mintState.status === 'LIVE' ? 12 : 0;
  const readiness = Math.min(96, Math.max(24, Math.round((confidence + functionConfidence) / 2) + liveBonus));
  const risk = result.riskAnalysis.riskScore;
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));

  return { opportunity: Math.round(opportunity), risk: Math.round(risk), readiness };
}

function formatLogTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

function formatSocialLabel(value: string) {
  return value === 'twitter' ? 'Twitter/X' : value.charAt(0).toUpperCase() + value.slice(1);
}

function AnalyzerDebugConsole({
  logs,
  open,
  onToggle,
}: {
  logs: AnalyzerDebugLog[];
  open: boolean;
  onToggle: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs, open]);

  const levelClass: Record<AnalyzerDebugLog['level'], string> = {
    info: 'text-sky-200',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-danger',
  };

  return (
    <Card className="overflow-hidden border-accent/20 bg-black/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 border-b border-border px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <Code2 className="h-5 w-5 text-accent" aria-hidden="true" />
          <span className="font-semibold text-text">Analyzer Debug Console</span>
          <Badge variant={logs.some((log) => log.level === 'error') ? 'danger' : logs.length > 0 ? 'info' : 'default'}>
            {logs.length} logs
          </Badge>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
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
                <span className="ml-2 text-muted/50">({log.stage})</span>
              </div>
            ))
          ) : (
            <div className="text-muted">Debug logs will appear here after Analyze starts.</div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function AnalyzerObservabilityDashboard({
  data,
  loading,
}: {
  data: AnalyzerObservability | null;
  loading: boolean;
}) {
  const serviceTone = (healthy: boolean | null) => {
    if (healthy === true) return 'success';
    if (healthy === false) return 'danger';
    return 'default';
  };

  return (
    <Card tone="elevated" className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <LineChart className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="font-semibold text-text">Analyzer Health</h2>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-36 w-full" />)}
        </div>
      ) : data ? (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              ['Total Analyses', String(data.analyzerMetrics.totalAnalyses)],
              ['Successful Analyses', String(data.analyzerMetrics.successfulAnalyses)],
              ['Failed Analyses', data.analyzerMetrics.failedAnalyses === null ? 'Not tracked' : String(data.analyzerMetrics.failedAnalyses)],
              ['Success Rate', formatPercent(data.analyzerMetrics.successRate)],
              ['Average Analysis Time', formatOptionalMilliseconds(data.analyzerMetrics.averageAnalysisTimeMs)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-white/5 p-3">
                <p className="text-xs uppercase text-muted">{label}</p>
                <p className="mt-2 font-mono text-lg font-semibold text-text">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.serviceHealth.map((service) => (
              <div key={service.service} className="rounded-lg border border-border bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-text">{service.service}</h3>
                  <Badge variant={serviceTone(service.healthy) as BadgeVariant}>
                    {service.healthy === null ? 'No data' : service.healthy ? 'Healthy' : 'Unhealthy'}
                  </Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-muted">Configured</span><span className="text-text">{service.configured ? 'YES' : 'NO'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Average Latency</span><span className="font-mono text-text">{formatOptionalMilliseconds(service.averageLatencyMs)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Last Success</span><span className="text-text">{formatRelativeTime(service.lastSuccess)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Last Failure</span><span className="text-text">{formatRelativeTime(service.lastFailure)}</span></div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-border bg-white/5 p-4">
              <h3 className="mb-3 font-semibold text-text">Provider Success Rate</h3>
              <div className="space-y-3">
                {data.providerRates.map((provider) => (
                  <div key={provider.provider} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                    <span className="text-text">{provider.provider}</span>
                    <span className="font-mono text-success">{formatPercent(provider.successPercent)}</span>
                    <span className="font-mono text-warning">{formatPercent(provider.failurePercent)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-white/5 p-4">
              <h3 className="mb-3 font-semibold text-text">RPC Monitoring</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><span className="text-muted">Current Primary Provider</span><span className="text-text">{data.rpcMonitoring.currentPrimaryProvider ?? 'Not selected'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted">Current Latency</span><span className="font-mono text-text">{formatOptionalMilliseconds(data.rpcMonitoring.currentLatencyMs)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted">Failover Count</span><span className="font-mono text-text">{data.rpcMonitoring.failoverCount}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted">Last Failover</span><span className="text-text">{formatRelativeTime(data.rpcMonitoring.lastFailover)}</span></div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-white/5 p-4">
            <h3 className="mb-3 font-semibold text-text">Most Recent Errors</h3>
            {data.recentErrors.length ? (
              <div className="space-y-2">
                {data.recentErrors.map((error) => (
                  <div key={`${error.service}-${error.createdAt}-${error.message}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-warning">{error.service}: {error.message}</span>
                    <span className="text-muted">{formatRelativeTime(error.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No analyzer provider errors have been recorded yet.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Analyzer observability is unavailable right now.</p>
      )}
    </Card>
  );
}

export default function AnalyzerClient({ initialInput = '' }: { initialInput?: string }) {
  const [url, setUrl] = useState(initialInput);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [debugLogs, setDebugLogs] = useState<AnalyzerDebugLog[]>([]);
  const [observability, setObservability] = useState<AnalyzerObservability | null>(null);
  const [observabilityLoading, setObservabilityLoading] = useState(true);

  const scores = useMemo(() => deriveScores(result), [result]);

  const loadObservability = async () => {
    setObservabilityLoading(true);
    try {
      const payload = await apiRequest<AnalyzerObservability>('/api/analyzer/observability');
      setObservability(payload);
    } catch {
      setObservability(null);
    } finally {
      setObservabilityLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadObservability();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const analyze = async () => {
    const input = url.trim();
    if (!input) {
      setError('Paste a launchpad URL, explorer URL, or contract address first.');
      setResult(null);
      return;
    }

    setAnalyzing(true);
    setError(null);
    setConsoleOpen(true);
    setDebugLogs([]);

    try {
      const payload = await apiRequest<AnalyzerResponse>('/api/analyzer', {
        method: 'POST',
        body: { input },
      });
      setResult(payload);
      setDebugLogs(payload.logs ?? []);
      void loadObservability();
    } catch (requestError) {
      setResult(null);
      if (requestError instanceof ApiClientError) {
        const payload = requestError.payload as { logs?: AnalyzerDebugLog[] } | null;
        setDebugLogs(payload?.logs ?? []);
      } else {
        setDebugLogs([]);
      }
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

  const resultCards = result
    ? [
        {
          title: 'Collection Overview',
          icon: Sparkles,
          items: [
            ['Name', result.metadata.name],
            ['Symbol', result.metadata.symbol],
            ['Supply', formatNumber(result.metadata.totalSupply)],
            ['Standard', result.metadata.tokenStandard],
          ],
        },
        {
          title: 'Risk Analysis',
          icon: ShieldAlert,
          items: [
            ['Contract confidence', confidenceLabel(result.intent.confidence)],
            ['Risk level', result.riskAnalysis.riskLevel],
            ['Owner', result.metadata.owner],
            ['Risk factors', String(result.riskAnalysis.riskFactors.length)],
          ],
        },
        {
          title: 'Market Signals',
          icon: LineChart,
          items: [
            ['Chain', result.intent.chain],
            ['Source', result.intent.sourcePlatform],
            ['Slug', result.intent.collectionSlug ?? 'Not provided'],
            ['Analyzed', new Date(result.analyzedAt).toLocaleTimeString()],
          ],
        },
        {
          title: 'Demand Forecast',
          icon: BarChart3,
          items: [
            ['Opportunity score', `${scores.opportunity}`],
            ['Owners', formatMetric(result.collectionIntelligence.ownerCount)],
            ['Floor', formatMetric(result.collectionIntelligence.floorPrice)],
            ['Readiness', `${scores.readiness}%`],
          ],
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        eyebrow="Flagship Analyzer"
        title="Analyzer"
        description="Move from launchpad URL to scored mint strategy with progressive disclosure and execution guardrails."
        actions={
          <Button onClick={analyze} loading={analyzing}>
            Analyze
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      />

      <div className="space-y-6">
        <Card tone="elevated" className="p-5">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                <Radar className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-text">Collection intake</h2>
                <p className="text-sm text-muted">URL, contract, or explorer link</p>
              </div>
            </div>
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
                placeholder="https://etherscan.io/address/0x..."
                aria-invalid={Boolean(error)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" type="button" onClick={pasteUrl}>
                  <Clipboard className="h-4 w-4" aria-hidden="true" />
                  Paste
                </Button>
                <Button type="button" onClick={analyze} loading={analyzing}>
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

        <AnalyzerDebugConsole
          logs={debugLogs}
          open={consoleOpen}
          onToggle={() => setConsoleOpen((value) => !value)}
        />

        <AnalyzerObservabilityDashboard data={observability} loading={observabilityLoading} />

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Opportunity Score" value={result ? String(scores.opportunity) : '--'} detail={result ? 'Derived from live contract signals' : 'Awaiting analysis'} icon={Sparkles} tone="accent" />
            <MetricCard label="Risk Score" value={result ? String(result.riskAnalysis.riskScore) : '--'} detail={result ? result.riskAnalysis.riskLevel : 'Awaiting analysis'} icon={AlertTriangle} tone="warning" />
            <MetricCard label="Readiness" value={result ? `${scores.readiness}%` : '--'} detail={result ? result.mintFunction.functionName : 'Execution plan pending'} icon={CheckCircle2} tone="success" />
          </div>

          {analyzing ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((item) => (
                <Card key={item} className="p-5">
                  <Skeleton className="h-5 w-44" />
                  <div className="mt-5 space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                </Card>
              ))}
            </div>
          ) : result ? (
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="grid gap-4 lg:grid-cols-2"
              >
                {resultCards.map((card) => (
                  <Card key={card.title} tone="interactive" className="p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <card.icon className="h-5 w-5 text-accent" aria-hidden="true" />
                      <h2 className="font-semibold text-text">{card.title}</h2>
                    </div>
                    <div className="space-y-3">
                      {card.items.map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-4 text-sm">
                          <span className="text-muted">{label}</span>
                          <span className="max-w-[60%] truncate text-right font-medium text-text">{value}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </motion.div>

              <Card tone="elevated" className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <LineChart className="h-5 w-5 text-accent" aria-hidden="true" />
                  <h2 className="font-semibold text-text">Collection Intelligence</h2>
                </div>
                <div className="mb-4 rounded-lg border border-border bg-white/5 p-4">
                  <p className="text-xs uppercase text-muted">Description</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{formatMetric(result.collectionIntelligence.description)}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Creator', formatMetric(result.collectionIntelligence.creator)],
                    ['Verified', formatVerified(result.collectionIntelligence.verified)],
                    ['Owners', formatMetric(result.collectionIntelligence.ownerCount)],
                    ['Items', formatMetric(result.collectionIntelligence.itemCount)],
                    ['Volume', formatMetric(result.collectionIntelligence.volume)],
                    ['Floor Price', formatMetric(result.collectionIntelligence.floorPrice)],
                    ['Market Status', result.collectionIntelligence.marketStatus],
                    ['Health Score', `${result.collectionIntelligence.healthScore}/100`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border bg-white/5 p-3">
                      <p className="text-xs uppercase text-muted">{label}</p>
                      <p className="mt-1 break-words text-sm font-medium text-text">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-muted">{result.collectionIntelligence.healthSummary}</p>
              </Card>

              {result.aiSummary ? (
                <Card tone="elevated" className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
                    <h2 className="font-semibold text-text">AI Analysis</h2>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    {[
                      ['Project Summary', result.aiSummary.projectSummary],
                      ['Risk Summary', result.aiSummary.riskSummary],
                      ['Market Summary', result.aiSummary.marketSummary],
                      ['Mint Summary', result.aiSummary.mintSummary],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-border bg-white/5 p-4">
                        <h3 className="mb-2 text-sm font-semibold text-text">{label}</h3>
                        <p className="text-sm leading-6 text-muted">{value}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              <Card tone="elevated" className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <Code2 className="h-5 w-5 text-accent" aria-hidden="true" />
                  <h2 className="font-semibold text-text">Analysis Details</h2>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    {[
                      ['Provider Used', result.providerUsed],
                      ['Cache Used', result.cacheUsed ? 'YES' : 'NO'],
                      ['Cache Hit Rate', `${result.performanceMetrics.cacheHitRate}%`],
                      ['RPC Provider', result.rpcProviderUsed ?? 'Not used'],
                      ['Analysis Duration', formatMilliseconds(result.analysisDurationMs)],
                      ['Fastest Provider', result.performanceMetrics.fastestProvider ?? 'Not tracked'],
                      ['Slowest Provider', result.performanceMetrics.slowestProvider ?? 'Not tracked'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-muted">{label}</span>
                        <span className="max-w-[60%] truncate text-right font-medium text-text">{value}</span>
                      </div>
                    ))}
                    <div className="pt-2">
                      <p className="mb-2 text-xs uppercase text-muted">Provider Chain</p>
                      <div className="space-y-2">
                        {result.providerChain.length ? result.providerChain.map((provider) => (
                          <div key={`${provider.provider}-${provider.durationMs}`} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white/5 px-3 py-2 text-sm">
                            <span className="text-text">{provider.provider}</span>
                            <span className={provider.status === 'success' ? 'text-success' : 'text-warning'}>
                              {provider.status === 'success' ? 'Success' : 'Failed'} - {formatMilliseconds(provider.durationMs)}
                            </span>
                          </div>
                        )) : (
                          <div className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-muted">No external provider chain recorded.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs uppercase text-muted">RPC Visibility</p>
                    <div className="mb-4 space-y-2">
                      {result.rpcProviders.length ? result.rpcProviders.map((provider) => (
                        <div key={provider.provider} className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-text">{provider.provider}{provider.selected ? ' selected' : ' fallback'}</span>
                            <span className={provider.healthy ? 'text-success' : 'text-warning'}>{provider.status}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
                            <span>{provider.configured ? 'Configured' : 'Not configured'}</span>
                            <span>{provider.latencyMs !== null ? `${provider.latencyMs}ms latency` : 'No latency'}</span>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-muted">RPC was not used for this analysis.</div>
                      )}
                    </div>
                    <p className="mb-2 text-xs uppercase text-muted">Timing Breakdown</p>
                    <div className="space-y-2">
                      {result.timingBreakdown.map((timing) => (
                        <div key={`${timing.stage}-${timing.durationMs}`} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white/5 px-3 py-2 text-sm">
                          <span className="text-text">{timing.stage}</span>
                          <span className="font-mono text-muted">{formatMilliseconds(timing.durationMs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card tone="elevated" className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <ExternalLink className="h-5 w-5 text-accent" aria-hidden="true" />
                  <h2 className="font-semibold text-text">Social Discovery</h2>
                </div>
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-white/5 p-3">
                    <p className="text-xs uppercase text-muted">Detected</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-text">{result.socialHealth.detectedCount}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-white/5 p-3">
                    <p className="text-xs uppercase text-muted">Missing</p>
                    <p className="mt-1 text-sm font-medium text-text">
                      {result.socialHealth.missing.length ? result.socialHealth.missing.map(formatSocialLabel).join(', ') : 'None'}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {(['website', 'twitter', 'discord', 'telegram', 'github', 'medium'] as const).map((key) => {
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
                  <ShieldAlert className="h-5 w-5 text-warning" aria-hidden="true" />
                  <h2 className="font-semibold text-text">Risk Assessment</h2>
                </div>
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-white/5 p-3">
                    <p className="text-xs uppercase text-muted">Risk Score</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-text">{result.riskAnalysis.riskScore}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-white/5 p-3">
                    <p className="text-xs uppercase text-muted">Risk Level</p>
                    <p className="mt-1 text-lg font-semibold text-text">{result.riskAnalysis.riskLevel}</p>
                  </div>
                </div>
                <p className="mb-3 text-sm text-muted">{result.riskAnalysis.riskSummary}</p>
                <div className="space-y-2">
                  {result.riskAnalysis.riskFactors.length ? result.riskAnalysis.riskFactors.map((factor) => (
                    <div key={factor} className="flex gap-3 rounded-lg border border-border bg-background/50 p-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
                      <p className="text-sm leading-6 text-muted">{factor}</p>
                    </div>
                  )) : (
                    <div className="rounded-lg border border-border bg-background/50 p-3 text-sm text-muted">No material risk factors were detected from available signals.</div>
                  )}
                </div>
              </Card>
            </div>
          ) : (
            <EmptyState
              icon={Radar}
              title="Ready to analyze"
              description="Paste an explorer URL, OpenSea collection URL, or direct contract address to resolve live metadata, risk posture, demand signals, and execution readiness."
            />
          )}

        </div>
      </div>
    </div>
  );
}
