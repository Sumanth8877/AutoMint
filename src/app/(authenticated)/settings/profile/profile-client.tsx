'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { KeyRound, Save, Trash2, User } from 'lucide-react';
import Button from '@/components/ui/Button';
import { ResetDataModal } from '@/components/settings/ResetDataModal';
import Card from '@/components/ui/Card';
import { apiRequest } from '@/lib/api/client';

type Notice = {
  type: 'success' | 'error';
  message: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray((error as { errors?: Array<{ message?: string }> }).errors)
  ) {
    const clerkMessage = (error as { errors: Array<{ message?: string }> }).errors[0]?.message;
    if (clerkMessage) return clerkMessage;
  }
  return fallback;
}

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export default function ProfileClient() {
  const router = useRouter();
  const { signOut } = useClerk();
  const { isLoaded, user } = useUser();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? '';
  const clerkDisplayName = useMemo(() => {
    if (!user) return '';
    return user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || '';
  }, [user]);
  const displayNameValue = displayName ?? clerkDisplayName;

  useEffect(() => {
    if (!notice || notice.type !== 'success') return;

    const timeout = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    const trimmedName = displayNameValue.trim();
    if (!trimmedName) {
      setNotice({ type: 'error', message: 'Display name is required.' });
      return;
    }

    setSavingName(true);
    setNotice(null);

    try {
      await user.update(splitDisplayName(trimmedName));
      await user.reload();
      setDisplayName(null);
      setNotice({ type: 'success', message: 'Profile updated successfully.' });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error, 'Failed to update profile.') });
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    if (!newPassword || newPassword !== confirmPassword) {
      setNotice({ type: 'error', message: 'New password and confirmation must match.' });
      return;
    }

    setSavingPassword(true);
    setNotice(null);

    try {
      await user.updatePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
        signOutOfOtherSessions: false,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice({ type: 'success', message: 'Password changed successfully.' });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error, 'Failed to change password.') });
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteAccount() {
    if (!user || deleteConfirmation !== 'DELETE') return;

    setDeletingAccount(true);
    setNotice(null);

    try {
      await apiRequest<{ success: true }>('/api/settings/profile', {
        method: 'DELETE',
        cache: 'no-store',
      });
      await signOut({ redirectUrl: '/' });
      router.refresh();
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error, 'Failed to delete account.') });
      setDeletingAccount(false);
    }
  }

  if (!isLoaded) {
    return <div className="text-sm text-muted">Loading profile...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text">Profile</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Manage your AutoMint account details and Clerk-backed account security.
        </p>
      </div>

      {notice ? (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-success/25 bg-success/10 text-success'
              : 'border-danger/25 bg-danger/10 text-danger'
          }`}
          role={notice.type === 'success' ? 'status' : 'alert'}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="grid gap-4">
        <Card className="p-5">
          <div className="flex items-start gap-3 border-b border-border pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
              <User className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold text-text">Account Details</h2>
              <p className="mt-1 text-sm text-muted">Your email address comes from Clerk and is read-only in AutoMint.</p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-text">Display Name</span>
              <input
                type="text"
                value={displayNameValue}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10 rounded-lg border border-border bg-white/5 px-3 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                autoComplete="name"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-text">Email Address</span>
              <input
                type="email"
                value={email}
                readOnly
                className="h-10 cursor-not-allowed rounded-lg border border-border bg-white/[0.03] px-3 text-sm text-muted outline-none"
              />
            </label>
            <div className="lg:col-span-2">
              <Button type="submit" loading={savingName} disabled={!user}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {savingName ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <div className="flex items-start gap-3 border-b border-border pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-warning/20 bg-warning/10 text-warning">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold text-text">Password</h2>
              <p className="mt-1 text-sm text-muted">Change your Clerk password. AutoMint never stores password values.</p>
            </div>
          </div>

          <form onSubmit={changePassword} className="mt-5 grid gap-4 lg:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-text">Current Password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="h-10 rounded-lg border border-border bg-white/5 px-3 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                autoComplete="current-password"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-text">New Password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="h-10 rounded-lg border border-border bg-white/5 px-3 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-text">Confirm New Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-10 rounded-lg border border-border bg-white/5 px-3 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                autoComplete="new-password"
              />
            </label>
            <div className="lg:col-span-3">
              <Button type="submit" variant="secondary" loading={savingPassword} disabled={!user}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {savingPassword ? 'Changing...' : 'Change Password'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="border-danger/25 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-text">Danger Zone</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                  Deleting your account removes your Clerk user account and signs you out. This action cannot be undone.
                </p>
              </div>
            </div>
            <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete Account
            </Button>
          </div>
        </Card>
      </div>

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              if (!deletingAccount) setDeleteOpen(false);
            }}
            aria-label="Close delete account confirmation"
          />
          <Card className="relative z-10 w-full max-w-lg p-5 shadow-2xl">
            <h2 id="delete-account-title" className="text-lg font-semibold text-text">Delete Account</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              This permanently deletes your account. Type DELETE to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-4 h-10 w-full rounded-lg border border-border bg-white/5 px-3 text-sm text-text outline-none transition focus:border-danger focus:ring-2 focus:ring-danger/20"
              autoComplete="off"
            />
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deletingAccount}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={deletingAccount}
                disabled={deleteConfirmation !== 'DELETE'}
                onClick={() => void deleteAccount()}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {deletingAccount ? 'Deleting...' : 'Delete Account'}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {resetOpen && <ResetDataModal onClose={() => setResetOpen(false)} />}
    </div>
  );
}
