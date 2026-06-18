'use client';

import React from 'react';
import { Palette, Bell, User, Shield } from 'lucide-react';
import Card from '@/components/ui/Card';

const settingsSections = [
  {
    title: 'Theme',
    description: 'Customize your dashboard appearance and layout preferences',
    icon: Palette,
    color: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  },
  {
    title: 'Notifications',
    description: 'Configure email and in-app notification preferences',
    icon: Bell,
    color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  },
  {
    title: 'Profile',
    description: 'Manage your account profile and personal information',
    icon: User,
    color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  {
    title: 'Security',
    description: 'Manage security settings and connected applications',
    icon: Shield,
    color: 'bg-green-500/10 text-green-500 border-green-500/20',
  },
];

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1
          className="text-2xl sm:text-3xl font-bold text-white"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
        >
          Settings
        </h1>
        <p className="text-muted mt-1">Manage your dashboard preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {settingsSections.map((section, i) => {
          const Icon = section.icon;
          return (
            <Card key={i} className="p-6 hover:border-blue-400/30 transition-all duration-300 cursor-pointer">
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl border ${section.color}`}>
                  <Icon size={22} />
                </div>
                <div>
                  <h3
                    className="text-lg font-semibold text-white mb-1"
                    style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                  >
                    {section.title}
                  </h3>
                  <p className="text-sm text-muted">{section.description}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}