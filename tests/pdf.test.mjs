import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdfResultSchema } from '../packages/pdf-schema/src/index.ts';
import { readPdfUpload, pdfFilename } from '../apps/web/src/lib/pdf-storage.ts';
const result = { pageCount: 2, title: 'Document', units: [{ title: 'All', startPage: 1, endPage: 2 }], textExcerpt: 'Text', analysisOutline: 'All pages', warnings: [] };
test('PDF result requires exact coverage and bounded parser output', () => {
  assert.deepEqual(pdfResultSchema.parse(result), result);
  for (const value of [{ ...result, pageCount: 501 }, { ...result, units: [] }, { ...result, units: [{ title: 'Gap', startPage: 2, endPage: 2 }] }, { ...result, textExcerpt: 'x'.repeat(12001) }, { ...result, warnings: ['AI_GUESS'] }, { ...result, secret: 'unknown' }]) assert.equal(pdfResultSchema.safeParse(value).success, false);
});
test('raw PDF uploads enforce declared and streamed byte bounds plus PDF header', async () => {
  const req = (body, headers = {}) => new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/pdf', ...headers }, body });
  assert.equal((await readPdfUpload(req('%PDF-1.7\n'))).byteLength, 9);
  await assert.rejects(readPdfUpload(req('not a pdf')));
  await assert.rejects(readPdfUpload(req('%PDF-1.7', { 'Content-Length': '10485761' })));
  await assert.rejects(readPdfUpload(req(new Uint8Array(10485761))));
  await assert.rejects(readPdfUpload(req('%PDF-', { 'Content-Type': 'text/plain' })));
});
test('filenames never become paths or response-header injection', () => {
  assert.equal(pdfFilename(encodeURIComponent('학습자료.pdf')), '학습자료.pdf');
  assert.equal(pdfFilename(encodeURIComponent('../folder/book.pdf')), '.._folder_book.pdf');
  assert.throws(() => pdfFilename('%broken'));
  assert.throws(() => pdfFilename(encodeURIComponent('bad\r\n.pdf')));
});
