import { bookApiConfig } from '@/lib/books-api';
import { createQuoteHandlers } from '@/lib/book-quotes-api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const handlers = () => createQuoteHandlers(bookApiConfig());
export async function GET(request: Request, context: Context) {
  return handlers().LIST(request, (await context.params).id);
}
export async function POST(request: Request, context: Context) {
  return handlers().CREATE(request, (await context.params).id);
}
