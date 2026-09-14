import { bookApiConfig, createBookHandlers } from '@/lib/books-api';

export const runtime = 'nodejs';
export async function POST(request: Request) { return createBookHandlers(bookApiConfig()).POST(request); }
export async function GET(request: Request) { return createBookHandlers(bookApiConfig()).GET(request); }
