// A convenience alias for the explicitly provisioned local development account.
// This does not assign permissions or replace server-side token verification.
export function resolveLoginEmail(identifier: string, supabaseUrl: string | undefined): string {
  const value = identifier.trim();
  if (value.toLowerCase() !== 'admin' || !supabaseUrl) return value;
  try {
    const hostname = new URL(supabaseUrl).hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return 'admin@paceon.example';
  } catch { /* An invalid configuration cannot enable the local alias. */ }
  return value;
}
