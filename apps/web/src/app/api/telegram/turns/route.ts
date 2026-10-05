import { bookApiConfig } from '@/lib/books-api';
import { createTelegramHandlers } from '@/lib/telegram-api';
export const runtime = 'nodejs';
export async function GET(request: Request) { return createTelegramHandlers(bookApiConfig()).TURNS(request); }
