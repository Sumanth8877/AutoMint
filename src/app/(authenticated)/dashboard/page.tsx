'use client';

import React from 'react';
import { Wallet, Folders, Play, Clock } from 'lucide-react';
import StatCard from '@/components/dashboard/StatCard';
import ActivityCard from '@/components/dashboard/ActivityCard';

export default function DashboardPage() {
  const stats = [
    {
      title: 'Wallets',
      value: 0,
      icon: <Wallet size={22} />,
    },
    {
      title: 'Collections',
      value: 0,
      icon: <Folders size={22} />,
    },
    {
      title: 'Active Tasks',
      value: 0,
      icon: <Play size={22} />,
    },
    {
      title: 'Mint History',
      value: 0,
      icon: <Clock size={22} />,
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-2xl sm:text-3xl font-bold text-white"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
        >
          Dashboard
        </h1>
        <p className="text-muted mt-1">Overview of your minting activity</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <StatCard key={i} title={stat.title} value={stat.value} icon={stat.icon} />
        ))}
      </div>

      {/* Recent Activity */}
      <ActivityCard />
    </div>
  );
}