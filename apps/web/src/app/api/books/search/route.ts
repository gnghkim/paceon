import { createSearchHandler } from '@/lib/books-api';

export const runtime = 'nodejs';
export async function GET(request: Request) { return createSearchHandler()(request); }
