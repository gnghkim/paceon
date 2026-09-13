import { bookApiConfig } from '@/lib/books-api';
import { createProgressHandler } from '@/lib/progress-api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return createProgressHandler(bookApiConfig())(request, (await context.params).id);
}
