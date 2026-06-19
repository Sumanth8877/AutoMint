'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

const settingsCategories = [
  {
    title: 'General',
    items: [
      { label: 'Profile', description: 'Manage your account information' },
      { label: 'Appearance', description: 'Theme and display preferences' },
      { label: 'Language', description: 'Select your preferred language' },
    ],
  },
  {
    title: 'Wallets',
    items: [
      { label: 'Connected Wallets', description: 'Manage your wallet connections' },
      { label: 'Default Wallet', description: 'Set your primary wallet' },
      { label: 'Network Preferences', description: 'Configure chain settings' },
    ],
  },
  {
    title: 'RPC Providers',
    items: [
      { label: 'Provider Settings', description: 'Configure RPC endpoints' },
      { label: 'Gas Optimization', description: 'Gas price strategies' },
      { label: 'Timeout Settings', description: 'Request timeout configuration' },
    ],
  },
  {
    title: 'Execution',
    items: [
      { label: 'Mint Settings', description: 'Default mint parameters' },
      { label: 'Retry Logic', description: 'Failure retry configuration' },
      { label: 'Gas Limits', description: 'Custom gas limit settings' },
    ],
  },
  {
    title: 'Notifications',
    items: [
      { label: 'Alert Preferences', description: 'Configure notification types' },
      { label: 'Email Notifications', description: 'Manage email alerts' },
      { label: 'Push Notifications', description: 'Browser notification settings' },
    ],
  },
  {
    title: 'Security',
    items: [
      { label: 'Two-Factor Auth', description: 'Enable 2FA for added security' },
      { label: 'Session Management', description: 'Manage active sessions' },
      { label: 'API Keys', description: 'Manage your API access keys' },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-2">Settings</h1>
        <p className="text-white/60 text-sm">Configure your AutoMint preferences</p>
      </div>

      <div className="space-y-8">
        {settingsCategories.map((category, categoryIndex) => (
          <div key={categoryIndex}>
            <h2 className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-4">
              {category.title}
            </h2>
            <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg overflow-hidden">
              {category.items.map((item, itemIndex) => (
                <button
                  key={itemIndex}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-white/5 transition-colors border-b border-[rgba(255,255,255,0.06)] last:border-0 group"
                >
                  <div className="text-left">
                    <p className="text-white text-sm font-medium">{item.label}</p>
                    <p className="text-white/40 text-xs mt-0.5">{item.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}