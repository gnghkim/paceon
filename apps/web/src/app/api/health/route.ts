import type { HealthResponse } from '@paceon/shared';

export function GET() {
  return Response.json({ status: 'ok', service: 'web', check: 'liveness' } satisfies HealthResponse, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
