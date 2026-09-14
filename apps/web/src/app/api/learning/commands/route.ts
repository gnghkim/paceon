import { bookApiConfig } from '@/lib/books-api';
import { createLearningHandlers } from '@/lib/learning-api';
export const runtime = 'nodejs';
export async function POST(request:Request) {
  return createLearningHandlers(bookApiConfig(),process.env.AI_ENABLED === 'true').COMMAND(request);
}
