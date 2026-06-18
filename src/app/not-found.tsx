'use client';

import React from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#050816] flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-20 h-20 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl font-bold text-blue-500">404</span>
        </div>
        <h1
          className="text-3xl font-bold text-white mb-3"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
        >
          Page not found
        </h1>
        <p className="text-muted mb-8 max-w-md">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/">
          <Button variant="primary" size="lg">
            Back to Home
          </Button>
        </Link>
      </div>
    </div>
  );
}