import { bookApiConfig } from '@/lib/books-api';
import { createLearningHandlers } from '@/lib/learning-api';
export const runtime = 'nodejs';
const handlers = () => createLearningHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true');
export async function GET(request: Request) { return handlers().LIST(request); }
export async function POST(request: Request) { return handlers().POST(request); }
