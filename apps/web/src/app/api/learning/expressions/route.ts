import { bookApiConfig } from '@/lib/books-api';
import { createExpressionHandlers } from '@/lib/expressions-api';
export const runtime = 'nodejs';
const handlers = () => createExpressionHandlers(bookApiConfig());
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
export async function PATCH(request: Request) { return handlers().PATCH(request); }
export async function DELETE(request: Request) { return handlers().DELETE(request); }
