import { bookApiConfig } from '@/lib/books-api';
import { createWorkspaceHandlers } from '@/lib/workspace-api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return createWorkspaceHandlers(bookApiConfig()).PLAN(request, (await context.params).id);
}
