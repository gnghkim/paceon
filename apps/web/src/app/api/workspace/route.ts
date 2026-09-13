import { bookApiConfig } from '@/lib/books-api';
import { createWorkspaceHandlers } from '@/lib/workspace-api';
export const runtime = 'nodejs';
export async function GET(request: Request) { return createWorkspaceHandlers(bookApiConfig()).GET(request); }
