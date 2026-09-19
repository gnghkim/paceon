import { bookApiConfig } from '@/lib/books-api';
import { createRecallHandlers } from '@/lib/recall-api';
export const runtime = 'nodejs';
const handlers = () => createRecallHandlers(bookApiConfig());
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
