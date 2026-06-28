"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/page-header";

type ServiceStatus = {
  name: string;
  configured: boolean;
};

type UsageResponse = {
  services: ServiceStatus[];
  fetchedAt: string;
};

export default function ApiKeysClient({ configured }: { configured: boolean }) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const didFetch = useRef(false);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/usage");
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

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </div>

      <PageHeader
        title="API Keys"
        description="Status of all integrations. Keys are managed via environment variables in Vercel."
      />

      {/* AutoMint API Key */}
      <Card className="p-6">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted">
            AUTOMINT_API_KEY
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-4">
            {configured ? (
              <>
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                <div>
                  <span className="text-sm font-medium text-text">Configured</span>
                  <p className="text-xs text-muted">
                    Programmatic access is enabled via the{" "}
                    <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">
                      AUTOMINT_API_KEY
                    </code>{" "}
                    environment variable.
                  </p>
                </div>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 shrink-0 text-red-500" />
                <div>
                  <span className="text-sm font-medium text-text">Not configured</span>
                  <p className="text-xs text-muted">
                    Set{" "}
                    <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">
                      AUTOMINT_API_KEY
                    </code>{" "}
                    in Vercel to enable programmatic access.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Service Integrations */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text mb-4">Service Integrations</h2>

        {loading && services.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {services.map((svc) => (
              <div key={svc.name} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-text">{svc.name}</span>
                {svc.configured ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 font-medium">
                    <XCircle className="h-3.5 w-3.5" />
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
