import { bookApiConfig } from '@/lib/books-api';
import { createMaterialImportHandlers } from '@/lib/material-import-api';
export const runtime = 'nodejs';
// 남의 페이지를 읽고 글을 뽑는 데 시간이 걸릴 수 있다.
export const maxDuration = 30;
export async function POST(request: Request) {
  return createMaterialImportHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true').START(request);
}
