import ExecutionSettingsClient from './execution-settings-client';

// Cache this page for 4 hours
export const revalidate = 14400;

export default function ExecutionSettingsPage() {
  return <ExecutionSettingsClient />;
}
