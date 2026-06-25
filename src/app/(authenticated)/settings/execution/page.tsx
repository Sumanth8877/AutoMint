import ExecutionSettingsClient from './execution-settings-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function ExecutionSettingsPage() {
  return <ExecutionSettingsClient />;
}
