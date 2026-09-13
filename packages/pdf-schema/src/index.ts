import { z } from 'zod';
export const PDF_MAX_BYTES = 10485760;
export const pdfStatusSchema = z.enum(['UPLOADING', 'PENDING', 'PROCESSING', 'READY', 'FAILED', 'IMPORTED']);
export const pdfResultSchema = z.object({
  pageCount: z.number().int().min(1).max(500),
  title: z.string().trim().min(1).max(500),
  units: z.array(z.object({ title: z.string().trim().min(1).max(500), startPage: z.number().int().min(1), endPage: z.number().int().min(1) }).strict()).min(1).max(500),
  textExcerpt: z.string().max(12000),
  analysisOutline: z.string().max(12000),
  warnings: z.array(z.enum(['NO_TEXT', 'NO_OUTLINE', 'TRUNCATED_TEXT', 'INVALID_OUTLINE'])).max(4),
}).strict().refine(value => {
  let nextPage = 1;
  for (const unit of value.units) {
    if (unit.startPage !== nextPage || unit.endPage < unit.startPage || unit.endPage > value.pageCount) return false;
    nextPage = unit.endPage + 1;
  }
  return nextPage === value.pageCount + 1;
}, '페이지 범위가 전체 문서를 연속으로 포함해야 합니다.');
export type PdfParseResult = z.infer<typeof pdfResultSchema>;
export type PdfStatus = z.infer<typeof pdfStatusSchema>;
export const pdfActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), title: z.string().trim().min(1).max(500), currentPage: z.number().int().min(0).max(500) }).strict(),
  z.object({ action: z.literal('retry') }).strict(),
]);
