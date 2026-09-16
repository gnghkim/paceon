import { bookApiConfig } from '@/lib/books-api';
import { createPushHandlers } from '@/lib/push-api';
export const runtime = 'nodejs';
const handlers = () => createPushHandlers(bookApiConfig());
export async function GET(request: Request) { return handlers().GET(request); }
export async function PUT(request: Request) { return handlers().PUT(request); }
export async function DELETE(request: Request) { return handlers().DELETE(request); }
