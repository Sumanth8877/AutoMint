import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import {
  getEmailNotificationPreferences,
  isResendConfigured,
  updateEmailNotificationPreferences,
} from '@/lib/services/email-notification.service';

type EmailPreferenceBody = {
  emailEnabled?: unknown;
  mintScheduledEnabled?: unknown;
  mintSuccessEnabled?: unknown;
  mintFailedEnabled?: unknown;
  systemErrorsEnabled?: unknown;
};

function normalizeBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false`);
  return value;
}

async function getResponse(userId: string) {
  const [preference, userRows] = await Promise.all([
    getEmailNotificationPreferences(userId),
    getDb().select().from(users).where(eq(users.id, userId)).limit(1),
  ]);

  return {
    preferences: {
      emailEnabled: preference.emailEnabled,
      mintScheduledEnabled: preference.mintScheduledEnabled,
      mintSuccessEnabled: preference.mintSuccessEnabled,
      mintFailedEnabled: preference.mintFailedEnabled,
      systemErrorsEnabled: preference.systemErrorsEnabled,
      updatedAt: preference.updatedAt.toISOString(),
    },
    destinationEmail: userRows[0]?.email ?? '',
    provider: 'Resend',
    providerConfigured: isResendConfigured(),
  };
}

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    return NextResponse.json(await getResponse(authResult.userId));
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load email notification settings') }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<EmailPreferenceBody>(req);
    await updateEmailNotificationPreferences(authResult.userId, {
      emailEnabled: normalizeBoolean(body.emailEnabled, 'emailEnabled'),
      mintScheduledEnabled: normalizeBoolean(body.mintScheduledEnabled, 'mintScheduledEnabled'),
      mintSuccessEnabled: normalizeBoolean(body.mintSuccessEnabled, 'mintSuccessEnabled'),
      mintFailedEnabled: normalizeBoolean(body.mintFailedEnabled, 'mintFailedEnabled'),
      systemErrorsEnabled: normalizeBoolean(body.systemErrorsEnabled, 'systemErrorsEnabled'),
    });

    return NextResponse.json(await getResponse(authResult.userId));
  } catch (error) {
    return handleRouteError(error, 'Failed to update email notification settings');
  }
}
