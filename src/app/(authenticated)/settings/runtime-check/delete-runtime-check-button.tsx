'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';

type DeleteState = {
  tone: 'success' | 'error';
  message: string;
};

export default function DeleteRuntimeCheckButton() {
  const [deleting, setDeleting] = useState(false);
  const [state, setState] = useState<DeleteState | null>(null);

  async function deleteRuntimeCheck() {
    const confirmed = window.confirm('Delete the runtime check page and cleanup route source files?');
    if (!confirmed) return;

    setDeleting(true);
    setState(null);

    try {
      const response = await fetch('/api/settings/runtime-check/delete', {
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete runtime check files.');
      }

      setState({
        tone: 'success',
        message: payload.message || 'Runtime check source files deleted.',
      });
    } catch (error) {
      setState({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete runtime check files.',
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" variant="danger" onClick={deleteRuntimeCheck} loading={deleting}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete Runtime Check
      </Button>
      {state ? (
        <p className={`text-xs ${state.tone === 'success' ? 'text-success' : 'text-danger'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
