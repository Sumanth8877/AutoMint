'use client';

import { useState } from 'react';
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
import Input from '@/components/ui/Input';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';

const resultCards = [
  {
    title: 'Collection Overview',
    icon: Sparkles,
    items: [
      ['Launchpad', 'Magic Eden'],
      ['Mint price', '0.08 ETH'],
      ['Supply', '5,000'],
      ['Phase', 'Allowlist opening'],
    ],
  },
  {
    title: 'Risk Analysis',
    icon: ShieldAlert,
    items: [
      ['Contract risk', 'Low'],
      ['Liquidity risk', 'Medium'],
      ['Bot pressure', 'High'],
      ['Team signal', 'Verified'],
    ],
  },
  {
    title: 'Market Signals',
    icon: LineChart,
    items: [
      ['Social velocity', '+18%'],
      ['Comparable floors', '1.4x mint'],
      ['Holder overlap', 'Strong'],
      ['Watchlist rank', '#12'],
    ],
  },
  {
    title: 'Demand Forecast',
    icon: BarChart3,
    items: [
      ['Sell-through', '72%'],
      ['First hour demand', 'Very high'],
      ['Flip window', '18-42 min'],
      ['Confidence', '84%'],
    ],
  },
];

const recommendations = [
  'Prepare 4 funded wallets with capped allocation per wallet.',
  'Set priority fee above current p75 gas for the first 8 minutes.',
  'Enable risk stop if contract source changes before mint opens.',
  'Monitor secondary floor for 20 minutes after reveal signal.',
];

const workflowSteps: Array<{
  label: string;
  status: string;
  icon: LucideIcon;
  color: string;
}> = [
  { label: 'Resolve collection', status: 'Complete', icon: CheckCircle2, color: 'text-success' },
  { label: 'Inspect contract', status: 'Complete', icon: CheckCircle2, color: 'text-success' },
  { label: 'Score risk', status: 'Complete', icon: CheckCircle2, color: 'text-success' },
  { label: 'Forecast demand', status: 'Running', icon: Gauge, color: 'text-accent' },
  { label: 'Prepare execution', status: 'Ready', icon: Target, color: 'text-warning' },
];

export default function AnalyzerPage() {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [hasResult, setHasResult] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);

  const analyze = () => {
    setAnalyzing(true);
    window.setTimeout(() => {
      setAnalyzing(false);
      setHasResult(true);
    }, 900);
  };

  const pasteUrl = async () => {
    const text = await navigator.clipboard.readText();
    setUrl(text);
  };

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
                <p className="text-sm text-muted">URL, contract, or launchpad slug</p>
              </div>
            </div>
            <div className="space-y-4">
              <Input
                label="Mint URL"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://tensor.trade/mint/project"
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
            <MetricCard label="Opportunity Score" value="84" detail="Strong, monitor gas" icon={Sparkles} tone="accent" />
            <MetricCard label="Risk Score" value="31" detail="Bot pressure elevated" icon={AlertTriangle} tone="warning" />
            <MetricCard label="Readiness" value="92%" detail="Execution plan valid" icon={CheckCircle2} tone="success" />
          </div>

          {hasResult ? (
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
                        <span className="text-right font-medium text-text">{value}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </motion.div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
            <Card tone="elevated" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Target className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-text">Strategy Recommendations</h2>
              </div>
              <div className="space-y-3">
                {recommendations.map((item) => (
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
                  ['Wallets funded', '4 / 4', 'success'],
                  ['Gas policy', 'p75 + 12%', 'warning'],
                  ['Risk gates', 'Active', 'success'],
                  ['Automation', 'Prepared', 'info'],
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
                <p>[resolver] launchpad=magiceden confidence=0.94</p>
                <p>[contract] source=verified payableMint=true selector=0x1249c58b</p>
                <p>[risk] contract=low liquidity=medium botPressure=high</p>
                <p>[strategy] wallets=4 maxGas=0.014 priority=p75+12%</p>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
