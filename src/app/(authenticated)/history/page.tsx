'use client';
import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, CheckCircle2, XCircle, Clock, Play, AlertCircle } from 'lucide-react';

export default function HistoryPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/activities');
        if (!res.ok) throw new Error('Failed to fetch activities');
        const data = await res.json();
        if (data.activities) {
          setEvents(data.activities);
        }
      } catch (err) {
        setError('Failed to load activity. Please try again.');
      } finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const groupedEvents = events.reduce((acc: any, event: any) => {
    const date = new Date(event.createdAt).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {});

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-[#18C964]" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-[#F31260]" />;
      case 'running':
      case 'active':
        return <Play className="w-4 h-4 text-[#4F8CFF]" />;
      default:
        return <Clock className="w-4 h-4 text-white/40" />;
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-2">Activity</h1>
        <p className="text-white/60 text-sm">Track your execution timeline</p>
      </div>

      {error && (
        <div className="mb-6 bg-[#F31260]/10 border border-[#F31260]/20 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-[#F31260]" />
          <span className="text-white/60 text-sm">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-8">
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-[#4F8CFF]/30 border-t-[#4F8CFF] animate-spin" />
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-xl bg-[#4F8CFF]/10 border border-[#4F8CFF]/20 flex items-center justify-center mb-4">
              <HistoryIcon className="w-8 h-8 text-[#4F8CFF]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No activity yet</h3>
            <p className="text-white/40 text-sm max-w-sm text-center">Your execution activity will appear here</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedEvents).map(([date, dayEvents]: [string, any]) => (
            <div key={date}>
              <h3 className="text-white/40 text-sm font-medium mb-4">{date}</h3>
              <div className="space-y-2">
                {dayEvents.map((event: any) => (
                  <div key={event.id} className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 hover:border-[rgba(255,255,255,0.12)] transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5">{getStatusIcon(event.status)}</div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-white font-medium text-sm">{event.type || 'Activity'}</p>
                          <p className="text-white/40 text-xs">{new Date(event.createdAt).toLocaleTimeString()}</p>
                        </div>
                        <p className="text-white/40 text-sm">{event.description || ''}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}