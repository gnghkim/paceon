import { bookApiConfig } from '@/lib/books-api';
import { createWorkspaceHandlers } from '@/lib/workspace-api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return createWorkspaceHandlers(bookApiConfig()).PLAN(request, (await context.params).id);
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return createWorkspaceHandlers(bookApiConfig()).PLAN_STATUS(request, (await context.params).id);
}
