import { bookApiConfig } from '@/lib/books-api';
import { createUnitMaterialHandlers } from '@/lib/unit-materials-api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return createUnitMaterialHandlers(bookApiConfig()).PROGRESS(request, (await context.params).id);
}
