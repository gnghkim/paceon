import { PDF_MAX_BYTES } from '@paceon/pdf-schema';
import { ApiError } from './books-api.ts';

export function pdfFilename(raw: string | null): string {
  if (!raw) throw new ApiError(400, '파일 이름을 확인해 주세요.');
  let filename: string;
  try { filename = decodeURIComponent(raw).trim().replaceAll(/[\\/]/g, '_'); }
  catch { throw new ApiError(400, '파일 이름을 확인해 주세요.'); }
  if (!filename || filename.length > 200 || /[\r\n\u0000-\u001f\u007f]/.test(filename) || !filename.toLowerCase().endsWith('.pdf')) throw new ApiError(400, 'PDF 파일 이름을 확인해 주세요.');
  return filename;
}
export async function readPdfUpload(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/pdf') throw new ApiError(415, 'PDF 파일만 업로드할 수 있습니다.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > PDF_MAX_BYTES)) throw new ApiError(413, 'PDF는 최대 10MiB까지 업로드할 수 있습니다.');
  return readPdfBytes(request.body);
}
export async function readPdfBytes(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body?.getReader();
  if (!reader) throw new ApiError(400, '파일이 비어 있습니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PDF_MAX_BYTES) { await reader.cancel(); throw new ApiError(413, 'PDF는 최대 10MiB까지 업로드할 수 있습니다.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  if (size < 5 || new TextDecoder().decode(result.subarray(0, 5)) !== '%PDF-') throw new ApiError(400, '올바른 PDF 파일을 선택해 주세요.');
  return result;
}
