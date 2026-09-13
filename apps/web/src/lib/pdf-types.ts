import type { PdfParseResult, PdfStatus } from '@paceon/pdf-schema';
export type { PdfParseResult, PdfStatus } from '@paceon/pdf-schema';
export interface PdfImportView {
  id: string; filename: string; fileSize: number; status: PdfStatus;
  result: PdfParseResult | null; errorCode: string | null; resourceId: string | null;
  createdAt: string; updatedAt: string;
}
