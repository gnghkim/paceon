import { bookApiConfig } from '@/lib/books-api';
import { createTelegramHandlers } from '@/lib/telegram-api';
export const runtime = 'nodejs';
const handlers = () => createTelegramHandlers(bookApiConfig());
export async function GET(request: Request) { return handlers().STATUS(request); }
export async function POST(request: Request) { return handlers().CODE(request); }
export async function DELETE(request: Request) { return handlers().UNLINK(request); }
