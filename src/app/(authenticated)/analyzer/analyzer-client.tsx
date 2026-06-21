'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  Gauge,
  LineChart,
  Radar,
  ShieldAlert,
  Sparkles,
  Target,
  Wallet,
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
  logs: AnalyzerDebugLog[];
  analyzedAt: string;
}

type AnalyzerDebugLog = {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  stage: string;
  message: string;
};

const workflowSteps: Array<{
  label: string;
  status: string;
  icon: LucideIcon;
  color: string;
}> = [
  { label: 'Resolve collection', status: 'API backed', icon: CheckCircle2, color: 'text-success' },
  { label: 'Inspect contract', status: 'On-chain', icon: CheckCircle2, color: 'text-success' },
  { label: 'Score risk', status: 'Derived', icon: ShieldAlert, color: 'text-warning' },
  { label: 'Forecast demand', status: 'Signals', icon: Gauge, color: 'text-accent' },
  { label: 'Prepare execution', status: 'Guarded', icon: Target, color: 'text-warning' },
];

function formatNumber(value: string | number | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 'Unknown';
  return number.toLocaleString();
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
  const risk = Math.max(12, 100 - readiness);
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));

  return { opportunity: Math.round(opportunity), risk: Math.round(risk), readiness };
}

function detectInputType(input: string) {
  const lower = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/i.test(input.trim())) return 'Direct Contract';
  if (lower.includes('opensea.io')) return 'OpenSea URL';
  if (lower.includes('etherscan.io') || lower.includes('basescan.org') || lower.includes('polygonscan.com')) return 'Explorer URL';
  if (lower.includes('solscan.io')) return 'Solscan URL';
  if (lower.includes('magiceden.io')) return 'Magic Eden URL';
  return 'Unknown URL';
}

function createClientLog(level: AnalyzerDebugLog['level'], stage: string, message: string): AnalyzerDebugLog {
  return {
    timestamp: new Date().toISOString(),
    level,
    stage,
    message,
  };
}

function formatLogTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
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

export default function AnalyzerClient({ initialInput = '' }: { initialInput?: string }) {
  const [url, setUrl] = useState(initialInput);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [debugLogs, setDebugLogs] = useState<AnalyzerDebugLog[]>([]);

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
    setConsoleOpen(true);
    setDebugLogs([
      createClientLog('info', 'input', 'Analysis started'),
      createClientLog('info', 'input', `Input received: ${input}`),
      createClientLog('success', 'input', `Input type detected: ${detectInputType(input)}`),
      createClientLog('info', 'input', 'Waiting for analyzer pipeline response'),
    ]);

    try {
      const payload = await apiRequest<AnalyzerResponse>('/api/analyzer', {
        method: 'POST',
        body: { input },
      });
      setResult(payload);
      setDebugLogs(payload.logs ?? []);
    } catch (requestError) {
      setResult(null);
      if (requestError instanceof ApiClientError) {
        const payload = requestError.payload as { logs?: AnalyzerDebugLog[] } | null;
        setDebugLogs((payload?.logs?.length ? payload.logs : [
          createClientLog('error', 'final_status', requestError.message),
        ]));
      } else {
        setDebugLogs([
          createClientLog('error', 'final_status', requestError instanceof Error ? requestError.message : 'Analyzer request failed.'),
        ]);
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
            ['Mint state', result.mintState.status],
            ['Owner', result.metadata.owner],
            ['Selector confidence', confidenceLabel(result.mintFunction.confidence)],
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
            ['Minted', result.mintState.minted !== undefined ? formatNumber(result.mintState.minted) : 'Unknown'],
            ['Max supply', result.mintState.maxSupply !== undefined ? formatNumber(result.mintState.maxSupply) : 'Unknown'],
            ['Readiness', `${scores.readiness}%`],
          ],
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        eyebrow="Flagship Workflow"
        title="Analyzer"
        description="Move from launchpad URL to scored mint strategy with progressive disclosure and execution guardrails."
        actions={
          <Button onClick={analyze} loading={analyzing}>
            Analyze
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
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

          <Card className="p-5">
            <h2 className="mb-4 font-semibold text-text">Workflow</h2>
            <div className="space-y-3">
              {workflowSteps.map((step) => (
                <div key={step.label} className="flex items-center gap-3 rounded-lg border border-border bg-white/5 p-3">
                  <step.icon className={`h-4 w-4 ${step.color}`} aria-hidden="true" />
                  <span className="text-sm text-text">{step.label}</span>
                  <span className="ml-auto text-xs text-muted">{step.status}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Opportunity Score" value={result ? String(scores.opportunity) : '--'} detail={result ? 'Derived from live contract signals' : 'Awaiting analysis'} icon={Sparkles} tone="accent" />
            <MetricCard label="Risk Score" value={result ? String(scores.risk) : '--'} detail={result ? `${result.mintState.status} mint state` : 'Awaiting analysis'} icon={AlertTriangle} tone="warning" />
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
          ) : (
            <EmptyState
              icon={Radar}
              title="Ready to analyze"
              description="Paste an explorer URL, OpenSea collection URL, or direct contract address to resolve live metadata, risk posture, demand signals, and execution readiness."
            />
          )}

          {result ? (
            <>
              <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
                <Card tone="elevated" className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <Target className="h-5 w-5 text-accent" aria-hidden="true" />
                    <h2 className="font-semibold text-text">Strategy Recommendations</h2>
                  </div>
                  <div className="space-y-3">
                    {[
                      `Use ${result.requirements.mintFunction} with selector confidence at ${Math.round(result.mintFunction.confidence * 100)}%.`,
                      `Treat ${result.intent.chain} gas policy as required before execution.`,
                      result.mintState.status === 'LIVE' ? 'Mint is live; keep risk gates active before broadcast.' : `Mint status is ${result.mintState.status}; schedule monitoring before execution.`,
                      `Contract standard is ${result.metadata.tokenStandard}; verify wallet approval assumptions before automation.`,
                    ].map((item) => (
                      <div key={item} className="flex gap-3 rounded-lg border border-border bg-background/50 p-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden="true" />
                        <p className="text-sm leading-6 text-muted">{item}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-accent" aria-hidden="true" />
                    <h2 className="font-semibold text-text">Execution Readiness</h2>
                  </div>
                  <div className="space-y-3">
                    {[
                      ['Mint function', result.mintFunction.functionName, 'info'],
                      ['Mint price', `${result.requirements.mintPrice} ETH`, 'success'],
                      ['Risk gates', scores.risk > 45 ? 'Review' : 'Active', scores.risk > 45 ? 'warning' : 'success'],
                      ['Automation', result.intent.isValid ? 'Prepared' : 'Needs review', result.intent.isValid ? 'info' : 'warning'],
                    ].map(([label, value, variant]) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted">{label}</span>
                        <Badge variant={variant as 'success' | 'warning' | 'info'}>{value}</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
