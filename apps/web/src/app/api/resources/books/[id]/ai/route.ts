import { createAiHandlers } from '@/lib/ai-api';
import { bookApiConfig } from '@/lib/books-api';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return createAiHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true').GET(request, (await context.params).id);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return createAiHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true').POST(request, (await context.params).id);
}
