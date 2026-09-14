import { bookApiConfig } from '@/lib/books-api';
import { createVideoHandlers } from '@/lib/learning-videos-api';
export const runtime = 'nodejs';
export const POST = (request: Request) => createVideoHandlers(bookApiConfig()).COMMAND(request);
