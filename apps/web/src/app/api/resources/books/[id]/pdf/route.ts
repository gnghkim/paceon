import { createPdfHandlers } from '@/lib/pdf-api';
import { bookApiConfig } from '@/lib/books-api';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return createPdfHandlers(bookApiConfig(), process.env.PDF_ENABLED === 'true').SOURCE(request, (await context.params).id);
}
