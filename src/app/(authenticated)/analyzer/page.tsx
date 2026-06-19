'use client';

import { useMemo, useState } from 'react';
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
  analyzedAt: string;
}

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

export default function AnalyzerPage() {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

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

    try {
      const response = await fetch('/api/analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const payload = await response.json() as AnalyzerResponse | { error?: string };

      if (!response.ok) {
        setResult(null);
        setError('error' in payload && payload.error ? payload.error : 'Analyzer request failed.');
        return;
      }

      setResult(payload as AnalyzerResponse);
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : 'Analyzer request failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const pasteUrl = async () => {
    const text = await navigator.clipboard.readText();
    setUrl(text);
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
            <div className="space-y-4">
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
            </div>
          </Card>

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

              <Card className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setLogsOpen((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 p-5 text-left"
                  aria-expanded={logsOpen}
                >
                  <span className="flex items-center gap-3">
                    <Code2 className="h-5 w-5 text-muted" aria-hidden="true" />
                    <span className="font-semibold text-text">Debug Logs</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted transition-transform ${logsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {logsOpen ? (
                  <div className="border-t border-border bg-background/70 p-5 font-mono text-xs leading-6 text-muted">
                    <p>[resolver] platform={result.intent.sourcePlatform} confidence={result.intent.confidence.toFixed(2)}</p>
                    <p>[contract] address={result.intent.contractAddress} standard={result.metadata.tokenStandard}</p>
                    <p>[mint] state={result.mintState.status} function={result.mintFunction.functionName}</p>
                    <p>[strategy] opportunity={scores.opportunity} risk={scores.risk} readiness={scores.readiness}</p>
                  </div>
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
