import { bookApiConfig } from '@/lib/books-api';
import { createUnitMaterialHandlers } from '@/lib/unit-materials-api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return createUnitMaterialHandlers(bookApiConfig()).CREATE(request);
}
