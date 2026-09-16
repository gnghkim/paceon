import { bookApiConfig } from '@/lib/books-api';
import { createWorkspaceHandlers } from '@/lib/workspace-api';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return createWorkspaceHandlers(bookApiConfig()).BOOK_STATUS(request, (await context.params).id);
}
