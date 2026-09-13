import { createPdfHandlers } from '@/lib/pdf-api';
import { bookApiConfig } from '@/lib/books-api';
export async function GET(request: Request) {
  return createPdfHandlers(bookApiConfig(), process.env.PDF_ENABLED === 'true').LIST(request);
}
export async function POST(request: Request) {
  return createPdfHandlers(bookApiConfig(), process.env.PDF_ENABLED === 'true').UPLOAD(request);
}
