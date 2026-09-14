import { createPdfHandlers } from '@/lib/pdf-api';
import { bookApiConfig } from '@/lib/books-api';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return createPdfHandlers(bookApiConfig(), process.env.PDF_ENABLED === 'true').GET(request, (await context.params).id);
}
export async function POST(request: Request, context: Context) {
  return createPdfHandlers(bookApiConfig(), process.env.PDF_ENABLED === 'true').ACTION(request, (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  return createPdfHandlers(bookApiConfig(), process.env.PDF_ENABLED === 'true').DELETE(request, (await context.params).id);
}
