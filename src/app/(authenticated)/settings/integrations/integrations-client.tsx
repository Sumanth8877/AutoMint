'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import Card from '@/components/ui/Card';

type ServiceStatus = {
  name: string;
  configured: boolean;
};

type UsageResponse = {
  services: ServiceStatus[];
  fetchedAt: string;
};

export default function IntegrationsClient({ configured }: { configured: boolean }) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const didFetch = useRef(false);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/usage');
      if (!res.ok) return;
      const data = (await res.json()) as UsageResponse;
      setServices(data.services);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!didFetch.current) {
      didFetch.current = true;
      void fetchServices();
    }
  }, [fetchServices]);

  const configuredCount = services.filter((s) => s.configured).length;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text">Integrations</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Status of every third-party service AutoMint depends on. Keys are managed via environment variables in Vercel.
        </p>
      </div>

      {/* AutoMint API Key */}
      <Card className="mb-4 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text">Programmatic Access</h3>
            <p className="mt-0.5 text-xs text-muted">
              <code className="rounded bg-white/5 px-1 py-0.5 font-mono">AUTOMINT_API_KEY</code> enables external clients.
            </p>
          </div>
          {configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Not configured
            </span>
          )}
        </div>
      </Card>

      {/* Service Integrations */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-text">Service Integrations</h3>
          {services.length > 0 ? (
            <span className="text-xs text-muted">
              {configuredCount} of {services.length} configured
            </span>
          ) : null}
        </div>

        {loading && services.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="-mx-2 divide-y divide-border/60">
            {services.map((svc) => (
              <div
                key={svc.name}
                className="flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.03]"
              >
                <span className="flex items-center gap-2.5 text-sm text-text">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${svc.configured ? 'bg-success' : 'bg-danger'}`}
                    aria-hidden="true"
                  />
                  {svc.name}
                </span>
                {svc.configured ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Not configured
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
