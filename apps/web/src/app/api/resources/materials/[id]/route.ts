import { bookApiConfig } from '@/lib/books-api';
import { createUnitMaterialHandlers } from '@/lib/unit-materials-api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return createUnitMaterialHandlers(bookApiConfig()).DETAIL(request, (await context.params).id);
}
export async function PATCH(request: Request, context: Context) {
  return createUnitMaterialHandlers(bookApiConfig()).STATUS(request, (await context.params).id);
}
