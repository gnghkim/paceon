import { bookApiConfig } from '@/lib/books-api';
import { createSpeechHandlers } from '@/lib/speech-api';
export const runtime = 'nodejs';
export const POST = (request: Request) => createSpeechHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true').COMMAND(request);
