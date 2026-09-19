import { bookApiConfig } from '@/lib/books-api';
import { createMaterialImportHandlers } from '@/lib/material-import-api';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return createMaterialImportHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true').STATUS(request, (await context.params).id);
}
