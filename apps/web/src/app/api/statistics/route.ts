import { bookApiConfig } from '@/lib/books-api';
import { createStatisticsHandler } from '@/lib/statistics-api';

export const runtime = 'nodejs';
export async function GET(request: Request) { return createStatisticsHandler(bookApiConfig())(request); }
