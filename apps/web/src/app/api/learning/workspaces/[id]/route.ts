import { bookApiConfig } from '@/lib/books-api';
import { createLearningHandlers } from '@/lib/learning-api';
export const runtime = 'nodejs';
type Context = { params: Promise<{id:string}> };
const handlers = () => createLearningHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true');
export async function GET(request:Request, context:Context) {return handlers().GET(request,(await context.params).id);}
export async function PATCH(request:Request, context:Context) {return handlers().PATCH(request,(await context.params).id);}
