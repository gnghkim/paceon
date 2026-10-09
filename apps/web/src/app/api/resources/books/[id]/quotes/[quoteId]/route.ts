import { bookApiConfig } from '@/lib/books-api';
import { createQuoteHandlers } from '@/lib/book-quotes-api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; quoteId: string }> };
const handlers = () => createQuoteHandlers(bookApiConfig());
export async function PATCH(request: Request, context: Context) {
  const { id, quoteId } = await context.params;
  return handlers().UPDATE(request, id, quoteId);
}
export async function DELETE(request: Request, context: Context) {
  const { id, quoteId } = await context.params;
  return handlers().REMOVE(request, id, quoteId);
}
