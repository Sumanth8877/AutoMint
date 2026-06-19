'use client';
import React from 'react';
import Card from '@/components/ui/Card';
import { CheckCircle2, Circle, Loader2, AlertCircle, Clock, Zap } from 'lucide-react';

export interface ActivityEvent {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  status: 'completed' | 'pending' | 'active' | 'failed';
  group?: string;
}

const iconMap = {
  completed: CheckCircle2,
  pending: Circle,
  active: Loader2,
  failed: AlertCircle,
};

const colorMap = {
  completed: '#18C964',
  pending: 'rgba(255,255,255,0.40)',
  active: '#4F8CFF',
  failed: '#F31260',
};

export default function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  const grouped = events.reduce<Record<string, ActivityEvent[]>>((acc, ev) => {
    const key = ev.group || new Date(ev.timestamp).toLocaleDateString();
    acc[key] = acc[key] || [];
    acc[key].push(ev);
    return acc;
  }, {});

  const keys = Object.keys(grouped).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <div className="space-y-8">
      {keys.map(day => (
        <div key={day}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-4">{day}</h3>
          <div className="space-y-0">
            {(grouped[day] || []).map((ev, i) => {
              const Icon = iconMap[ev.status] || Circle;
              const color = colorMap[ev.status] || colorMap.pending;
              const isLast = i === (grouped[day] || []).length - 1;
              return (
                <div key={ev.id} className="relative flex gap-4 pb-6">
                  {!isLast && (
                    <div className="absolute left-[11px] top-6 bottom-0 w-px bg-[rgba(255,255,255,0.06)]" />
                  )}
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: `${color}15`, border: `1px solid ${color}40` }}
                  >
                    <Icon size={12} style={{ color }} className={ev.status === 'active' ? 'animate-spin' : ''} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-white">{ev.title}</p>
                      <span className="text-xs text-white/40">
                        {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    {ev.description && <p className="text-xs text-white/40 mt-0.5">{ev.description}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}