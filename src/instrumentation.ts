export async function register() {
  // Validate required env vars at startup so missing vars surface
  // as a clear boot error rather than an obscure mid-request crash.
  const { validateEnv } = await import('@/lib/config/validate');
  validateEnv();
}
