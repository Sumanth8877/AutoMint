'use client';

import React from 'react';
import { Folders, Plus } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function CollectionsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold text-white"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Collections
          </h1>
          <p className="text-muted mt-1">Manage your NFT collections</p>
        </div>
        <Button variant="primary" size="md">
          <Plus size={16} />
          Add Collection
        </Button>
      </div>

      <Card className="p-12">
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
            <Folders size={28} className="text-muted" />
          </div>
          <h3
            className="text-lg font-semibold text-white mb-2"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            No collections added
          </h3>
          <p className="text-muted text-sm mb-6 text-center max-w-sm">
            Add your first NFT collection to start tracking mints, floor prices, and more.
          </p>
          <Button variant="primary" size="md">
            <Plus size={16} />
            Add Collection
          </Button>
        </div>
      </Card>
    </div>
  );
}