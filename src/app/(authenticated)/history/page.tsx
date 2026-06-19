'use client';
import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, Zap, ArrowUpRight } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ActivityTimeline, { ActivityEvent } from '@/components/activity/ActivityTimeline';

export default function HistoryPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/activities');
        const data = await res.json();
        if (data.activities) {
          setEvents(data.activities.map((a: any) => ({
            id: a.id,
            title: a.type || 'Activity',
            description: a.description || '',
            timestamp: a.createdAt,
            status: (a.status === 'success' ? 'completed' : a.status === 'error' ? 'failed' : a.status === 'running' ? 'active' : 'pending') as ActivityEvent['status'],
            group: new Date(a.createdAt).toLocaleDateString(),
          })));
        }
      } catch {} finally { setLoading(false); }
    };
    fetchData();
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Activity</h1>
        <p className="text-slate-500 mt-1 text-sm">Track your mint execution timeline</p>
      </div>

      {loading ? (
        <Card className="p-8">
          <div className="flex justify-center py-12"><div className="w-6 h-6 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" /></div>
        </Card>
      ) : events.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4"><HistoryIcon size={28} className="text-slate-500" /></div>
            <h3 className="text-lg font-semibold text-white mb-2">No activity yet</h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm text-center">Your mint activity will appear here once you start using AutoMint.</p>
            <a href="/dashboard"><Button variant="primary"><ArrowUpRight size={16} /> Go to Dashboard</Button></a>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <ActivityTimeline events={events} />
        </Card>
      )}
    </div>
  );
}