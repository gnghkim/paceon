"""Generate a small real PDF; no fixture libraries or external fonts."""
import io
import sys
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject


def pdf_bytes(pages=6, text=True, bookmarks=True, password=None):
    writer = PdfWriter()
    writer.add_metadata({"/Title": "PaceOn PDF sample"})
    for i in range(pages):
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
            page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
            stream = DecodedStreamObject()
            stream.set_data(f'BT /F1 12 Tf 72 720 Td (Sample learning text page {i+1}.) Tj ET'.encode())
            page[NameObject('/Contents')] = writer._add_object(stream)
    if bookmarks and pages >= 6:
        writer.add_outline_item('Foundations', 1)
        writer.add_outline_item('Practice', 3)
    if password is not None:
        writer.encrypt(password)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


if __name__ == '__main__':
    Path(sys.argv[1]).write_bytes(pdf_bytes())
