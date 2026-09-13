"""Isolated, credential-free PDF parser. Invoked only by pdf_worker."""
import io
import json
import logging
import sys

MAX_BYTES = 10485760
MAX_OUTPUT = 2000000


def bounded_text(value, maximum):
    """JSONB-safe Unicode bounded by the web contract's UTF-16 code units."""
    # Include one extra code point before normalization so a surrogate pair at
    # the boundary can be decoded together. Drop any pair split by truncation.
    value = str(value)[:maximum+1].encode('utf-16-le', errors='surrogatepass').decode('utf-16-le', errors='replace')
    value = value.replace('\x00', '\ufffd')
    return value.encode('utf-16-le')[:maximum*2].decode('utf-16-le', errors='ignore')


def parse(data, filename):
    from pypdf import PdfReader
    if len(data) > MAX_BYTES:
        raise ValueError('FILE_TOO_LARGE')
    if not data.startswith(b'%PDF-'):
        raise ValueError('INVALID_PDF')
    class UnencryptedReader(PdfReader):
        def _handle_encryption(self, password):
            # PdfReader otherwise tries an empty password during construction.
            # Reject before that attempt, including AES without crypto extras.
            raise ValueError('ENCRYPTED_PDF')

    reader = UnencryptedReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError('ENCRYPTED_PDF')
    count = len(reader.pages)
    if count > 500:
        raise ValueError('TOO_MANY_PAGES')
    if count < 1:
        raise ValueError('INVALID_PDF')
    warnings = []
    starts = {}
    try:
        for item in reader.outline:
            if isinstance(item, list):
                continue
            page = reader.get_destination_page_number(item)
            title = bounded_text(str(item.title).strip(), 500)
            if page is None or not 0 <= page < count or not title:
                raise ValueError()
            starts.setdefault(page + 1, title)
    except Exception:
        starts = {}
        warnings.append('INVALID_OUTLINE')
    if not starts:
        if not warnings:
            warnings.append('NO_OUTLINE')
        starts[1] = 'Whole document'
    elif min(starts) > 1:
        starts[1] = 'Front matter'
    pages = sorted(starts)
    units = [{'title': starts[start], 'startPage': start, 'endPage': pages[i+1]-1 if i+1<len(pages) else count} for i,start in enumerate(pages)]
    excerpt = ''
    sampled = min(count, 10)
    for i in range(sampled):
        text = bounded_text(reader.pages[i].extract_text() or '', 12002)
        excerpt += ('\n' if excerpt and text else '') + text
        if len(excerpt.encode('utf-16-le'))//2 > 12000:
            warnings.append('TRUNCATED_TEXT')
            excerpt = bounded_text(excerpt, 12000)
            break
    if sampled < count and 'TRUNCATED_TEXT' not in warnings:
        warnings.append('TRUNCATED_TEXT')
    if not excerpt.strip():
        warnings.append('NO_TEXT')
    title = bounded_text(str((reader.metadata or {}).get('/Title') or filename.removesuffix('.pdf')).strip(), 500) or 'PDF document'
    outline = '\n'.join(f"{u['title']} (pages {u['startPage']}-{u['endPage']})" for u in units)
    # Put the sampling disclosure first even for exceptionally long bookmarks.
    analysis = bounded_text('Sampled extracted text and PDF bookmark ranges (not the full document):\n'+outline+'\n\nSampled extracted text:\n'+excerpt, 12000)
    return dict(pageCount=count,title=title,units=units,textExcerpt=excerpt,analysisOutline=analysis,warnings=warnings)


def main():
    logging.disable(logging.CRITICAL)
    if sys.platform == 'linux':
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (20,20))
        resource.setrlimit(resource.RLIMIT_AS, (384*1024*1024,384*1024*1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT,MAX_OUTPUT))
        resource.setrlimit(resource.RLIMIT_CORE, (0,0))
    # Defense in depth: pypdf needs no sockets or process spawning.
    def audit(event, args):
        if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.posix_spawn'}:
            raise PermissionError('Parser operation disabled')
    sys.addaudithook(audit)
    try:
        result = {'result':parse(sys.stdin.buffer.read(MAX_BYTES+1), sys.argv[1])}
    except Exception as exc:
        code = str(exc)
        result = {'error':code if code in {'FILE_TOO_LARGE','INVALID_PDF','ENCRYPTED_PDF','TOO_MANY_PAGES'} else 'INVALID_PDF'}
    output = json.dumps(result, ensure_ascii=True).encode('ascii')
    if len(output) > MAX_OUTPUT:
        output = b'{"error":"INVALID_OUTPUT"}'
    sys.stdout.buffer.write(output)


if __name__ == '__main__':
    main()
