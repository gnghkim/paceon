import hashlib
import io
import os
import unittest
from unittest.mock import patch
from create_pdf_fixture import pdf_bytes
from pypdf import PdfWriter
from pypdf.generic import NumberObject
from app.pdf_worker import PdfSettings, PdfWorker, PdfResult, parse_isolated
from app.worker import SafeFailure


class PdfTests(unittest.TestCase):
    def test_real_bookmarks_and_text(self):
        result = parse_isolated(pdf_bytes(), 'sample.pdf')
        self.assertEqual(result['pageCount'], 6)
        self.assertEqual([(u['startPage'], u['endPage']) for u in result['units']], [(1,1),(2,3),(4,6)])
        self.assertIn('Sample learning text', result['textExcerpt'])
        self.assertIn('Sampled extracted text', result['analysisOutline'])

    def test_scan_is_ready(self):
        result = parse_isolated(pdf_bytes(text=False, bookmarks=False), 'scan.pdf')
        self.assertEqual(result['warnings'], ['NO_OUTLINE', 'NO_TEXT'])
        self.assertEqual(result['units'][0]['endPage'], 6)

    def test_safe_failures(self):
        for data, code in [(b'not pdf','INVALID_PDF'), (b'%PDF-broken','INVALID_PDF'), (pdf_bytes(password=''),'ENCRYPTED_PDF'), (pdf_bytes(pages=501),'TOO_MANY_PAGES'), (b'%PDF-'+b'x'*10485760,'FILE_TOO_LARGE')]:
            with self.subTest(code=code), self.assertRaisesRegex(SafeFailure, '^'+code+'$'):
                parse_isolated(data, 'file.pdf')

    def test_pdf_enabled_without_openai(self):
        with patch.dict(os.environ, {'PDF_ENABLED':'true','SUPABASE_URL':'http://localhost','SUPABASE_SERVICE_ROLE_KEY':'secret'}, clear=True):
            self.assertTrue(PdfSettings.from_env().enabled)

    def test_bookmarks_sort_deduplicate_and_ignore_nested(self):
        writer = PdfWriter(io.BytesIO(pdf_bytes(bookmarks=False)))
        parent = writer.add_outline_item('Last', 3)
        writer.add_outline_item('Nested ignored', 4, parent=parent)
        writer.add_outline_item('First', 0)
        writer.add_outline_item('Duplicate ignored', 0)
        output = io.BytesIO()
        writer.write(output)
        result = parse_isolated(output.getvalue(), 'sample.pdf')
        self.assertEqual([u['title'] for u in result['units']], ['First','Last'])

    def test_invalid_bookmark_falls_back(self):
        writer = PdfWriter(io.BytesIO(pdf_bytes(bookmarks=False)))
        ref = writer.add_outline_item('Broken', 0)
        ref.get_object()['/A']['/D'][0] = NumberObject(999)
        output = io.BytesIO()
        writer.write(output)
        result = parse_isolated(output.getvalue(), 'sample.pdf')
        self.assertIn('INVALID_OUTLINE', result['warnings'])
        self.assertEqual(result['units'][0]['title'], 'Whole document')

    def test_sampling_and_strict_coverage(self):
        result = parse_isolated(pdf_bytes(pages=11), 'sample.pdf')
        self.assertIn('TRUNCATED_TEXT', result['warnings'])
        self.assertNotIn('page 11', result['textExcerpt'])
        result['units'][0]['endPage'] = 2
        with self.assertRaises(ValueError):
            PdfResult.model_validate(result)

    def test_wall_timeout(self):
        with self.assertRaisesRegex(SafeFailure, '^PARSER_TIMEOUT$'):
            parse_isolated(pdf_bytes(), 'sample.pdf', timeout=0.000001)

    def test_real_pdf_text_and_titles_are_jsonb_and_javascript_safe(self):
        from pypdf.generic import DecodedStreamObject, NameObject
        writer = PdfWriter(io.BytesIO(pdf_bytes(bookmarks=False)))
        writer.add_metadata({'/Title': 'A\x00B' + chr(0x1f600)*500})
        writer.add_outline_item('Unit\x00' + chr(0x1f600)*500, 0)
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 72 720 Td (Text\\000' + b'x'*13000 + b') Tj ET')
        writer.pages[0][NameObject('/Contents')] = writer._add_object(stream)
        output = io.BytesIO()
        writer.write(output)
        result = parse_isolated(output.getvalue(), 'sample.pdf')
        for value, maximum in [(result['title'],500), (result['units'][0]['title'],500), (result['textExcerpt'],12000), (result['analysisOutline'],12000)]:
            self.assertNotIn('\x00', value)
            self.assertLessEqual(len(value.encode('utf-16-le'))//2, maximum)
        self.assertIn('\ufffd', result['title'])
        self.assertIn('\ufffd', result['units'][0]['title'])

    def test_unicode_normalizer_replaces_lone_surrogates_and_preserves_pairs(self):
        from app.pdf_parser import bounded_text
        self.assertEqual(bounded_text('a\x00\ud800b\udfff', 20), 'a\ufffd\ufffdb\ufffd')
        self.assertEqual(bounded_text(chr(0x1f600)*3, 5), chr(0x1f600)*2)

    def test_real_parse_finish_and_hash_failure(self):
        data = pdf_bytes()
        job = {'id':'11111111-1111-4111-8111-111111111111','user_id':'22222222-2222-4222-8222-222222222222','lease_token':'lease','filename':'sample.pdf','file_size':len(data),'content_sha256':hashlib.sha256(data).hexdigest()}
        job['storage_path'] = job['user_id']+'/'+job['id']+'.pdf'
        calls = []
        def transport(url, payload, headers, timeout):
            if url.endswith('claim_pdf_import'): return job
            calls.append(payload)
            return True
        worker = PdfWorker(PdfSettings(True,'http://localhost','secret'), transport=transport, download=lambda job: data)
        self.assertTrue(worker.run_once())
        self.assertEqual(calls[-1]['p_result']['pageCount'], 6)
        job['content_sha256'] = '0'*64
        self.assertTrue(worker.run_once())
        self.assertEqual(calls[-1]['p_error_code'], 'HASH_MISMATCH')


if __name__ == '__main__': unittest.main()
