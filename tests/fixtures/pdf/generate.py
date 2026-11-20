"""Builds the synthetic regulatory PDFs of tests/regulatory-pdf-text.smoke.mjs (no network, no personal data).

Run from the repository root: python3 -I tests/fixtures/pdf/generate.py  (needs reportlab, pikepdf, fpdf2 and soffice).
Each file reproduces how a modern exporter writes the official ARERA/Terna PDFs: LibreOffice tagged export with indirect
/Length, Type0 Identity-H fonts with ToUnicode, object streams + xref stream with PNG predictor, encryption with an empty
user password, an incremental update, and a hand-written file with ASCII85/LZW filters and inherited resources.
"""
import base64, io, os, re, shutil, subprocess, sys, tempfile, zlib
import pikepdf
from fpdf import FPDF
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = os.path.dirname(os.path.abspath(__file__))
DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
PREMISES = ["L'AUTORITÀ DI REGOLAZIONE PER ENERGIA RETI E AMBIENTE", "Nella 1312a riunione del 29 settembre 2026", "VISTI:", "la deliberazione dell'Autorità 27 giugno 2023, 362/2023/R/eel e il relativo Allegato A (TIV);", "RITENUTO NECESSARIO:", "aggiornare, per il trimestre ottobre - dicembre 2026, le condizioni economiche di cui al TIV;"]
A338 = ["DELIBERAZIONE 29 SETTEMBRE 2026", "338/2026/R/eel", "AGGIORNAMENTO, DAL 1° OTTOBRE 2026, DELLE CONDIZIONI ECONOMICHE DEL SERVIZIO DI TUTELA DELLA VULNERABILITÀ", *PREMISES, "DELIBERA", "Articolo 4", "Disposizioni in materia di corrispettivo capacità", "4.1 Il valore del corrispettivo capacità di cui ai commi 34.8, 41.9 e 48.9 del TIV è pari a:", "a) 0,3423 c€/kWh per il mese di ottobre 2026;", "b) 0,3423 c€/kWh per il mese di novembre 2026;", "c) 0,9243 c€/kWh per il mese di dicembre 2026.", "4.2 I predetti valori non comprendono le perdite di energia elettrica sulle reti."]
A343 = ["DELIBERAZIONE 29 SETTEMBRE 2026", "343/2026/R/com", "AGGIORNAMENTO, DAL 1° OTTOBRE 2026, DELLE COMPONENTI TARIFFARIE A COPERTURA DEGLI ONERI GENERALI DI SISTEMA", *PREMISES[:3], "DELIBERA", "Articolo 1", "Componenti tariffarie a copertura degli oneri generali di sistema", "1.1 Per il trimestre 1° ottobre - 31 dicembre 2026, i valori delle componenti tariffarie ASOS e ARIM", "di cui alla Tabella 1 allegata alla deliberazione 227/2026/R/com, sono confermati."]
# Invented quarter values (not Terna's): the total is the largest seven-decimal value.
TIDE = ["Corrispettivi di dispacciamento ai sensi del TIDE - 4° trimestre 2026", "Valori espressi in c€/kWh, al netto delle perdite", ("Uplift", "0,3011000"), ("di cui ATT MSDMB", "0,0712000"), ("di cui ATT DED", "0,1698000"), ("di cui RUPL", "0,0601000"), ("Unità essenziali in regime di reintegrazione", "0,2954000"), ("Modulazione straordinaria", "0,1201000"), ("Corrispettivo di dispacciamento", "0,9876000")]


def libreoffice(lines, name):
    work = tempfile.mkdtemp()
    with open(os.path.join(work, "doc.txt"), "w", encoding="utf-8") as handle: handle.write("\n".join(lines) + "\n")
    subprocess.run(["soffice", "--headless", "--infilter=Text (encoded):UTF8,LF,,,", "--convert-to", 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}', "--outdir", work, os.path.join(work, "doc.txt")], check=True, capture_output=True)
    shutil.move(os.path.join(work, "doc.pdf"), os.path.join(OUT, name)); shutil.rmtree(work)


def fpdf_type0(lines):
    pdf = FPDF(); pdf.add_font("DejaVu", "", DEJAVU); pdf.set_font("DejaVu", size=10); pdf.add_page()
    for line in lines: pdf.multi_cell(0, 6, line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def resave(source, name, **options):
    with pikepdf.open(source if isinstance(source, str) else io.BytesIO(source)) as pdf:
        pdf.save(os.path.join(OUT, name), object_stream_mode=pikepdf.ObjectStreamMode.generate, compress_streams=True, **options)


def reportlab_tide(path):
    pdfmetrics.registerFont(TTFont("DejaVu", DEJAVU))
    page = canvas.Canvas(path, pagesize=A4); y = 780
    for row in TIDE:
        if isinstance(row, str): page.setFont("DejaVu", 11); page.drawString(56, y, row)
        else: page.setFont("Helvetica", 10); page.drawString(56, y, row[0]); page.setFont("DejaVu", 10); page.drawRightString(520, y, row[1])
        y -= 20
    page.showPage(); page.save()


def incremental_update(name):
    """Appends an update that rewrites the catalog and the info dictionary, like a signature does (duplicate ids, /Prev)."""
    path = os.path.join(OUT, name); data = open(path, "rb").read()
    prev = int(re.findall(rb"startxref\s+(\d+)", data)[-1]); trailer = re.findall(rb"trailer\s*<<(.*?)>>\s*startxref", data, re.S)[-1]
    root = int(re.search(rb"/Root\s+(\d+)", trailer).group(1)); size = int(re.search(rb"/Size\s+(\d+)", trailer).group(1))
    catalog = re.search(rb"\n%d 0 obj\s*(.*?)endobj" % root, data, re.S).group(1).strip()
    offset = len(data) + 1
    update = b"\n%d 0 obj\n%s\nendobj\n" % (root, catalog)
    xref = len(data) + len(update)
    update += b"xref\n0 1\n0000000000 65535 f \n%d 1\n%010d 00000 n \ntrailer\n<</Size %d/Root %d 0 R/Prev %d>>\nstartxref\n%d\n%%%%EOF\n" % (root, offset, size, root, prev, xref)
    open(path, "ab").write(update)


def lzw(data):
    table = {bytes([i]): i for i in range(256)}; codes = [256]; width = 9; current = b""; out = []
    for byte in data:
        candidate = current + bytes([byte])
        if candidate in table: current = candidate; continue
        out.append((table[current], width)); table[candidate] = len(table) + 2; current = bytes([byte])
        if len(table) + 2 >= (1 << width) - 1 and width < 12: width += 1
    out.append((table[current], width)); out.append((257, width))
    bits = "".join(format(code, "0%db" % size) for code, size in [(256, 9)] + out)
    bits += "0" * (-len(bits) % 8)
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


def handcrafted(name):
    """Resources inherited from /Pages, an indirect /Font dictionary, /Contents arrays, ASCII85 over Flate, LZW, CR after
    "stream", a WinAnsi font with /Differences (/Euro), hex strings, the ' operator, octal escapes and a form XObject."""
    first = b"BT /TT2 11 Tf 72 760 Td (DELIBERAZIONE 29 SETTEMBRE 2026) Tj 0 -14 Td [(338/2026/R/eel)] TJ ET\n"
    second = b"BT /TT2 11 Tf 14 TL 72 700 Td [(4.1 Il valore del corrispettivo capacit) <e0> ( di cui ai commi 34.8, 41.9 e 48.9 del TIV ) <e8> ( pari a:)] TJ\n(a\\051 0,3423 c\\200/kWh per il mese di ottobre 2026;) '\n[(b\\) 0,3423 c) <80> (/kWh per il mese di ) -250 (novembre 2026;)] TJ ET\n/Fm1 Do\n"
    form = b"BT /TT2 11 Tf 72 658 Td (c\\) 0,9243 c\\200/kWh per il mese di dicembre 2026.) Tj ET\n"
    a85 = base64.a85encode(zlib.compress(second)) + b"~>"
    lzwed = lzw(first)
    objects = {
        1: b"<</Type/Catalog/Pages 2 0 R>>",
        2: b"<</Type/Pages/Kids[3 0 R]/Count 1/Resources 4 0 R/MediaBox[0 0 595 842]>>",
        3: b"<</Type/Page/Parent 2 0 R/Contents[5 0 R 6 0 R]>>",
        4: b"<</Font 7 0 R/XObject<</Fm1 9 0 R>>>>",
        7: b"<</TT2 8 0 R>>",
        8: b"<</Type/Font/Subtype/TrueType/BaseFont/TimesNewRomanPSMT/Encoding<</Type/Encoding/BaseEncoding/WinAnsiEncoding/Differences[128/Euro]>>>>",
    }
    body = [b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]; offsets = {}
    def emit(number, content): offsets[number] = sum(map(len, body)); body.append(b"%d 0 obj\n" % number + content + b"\nendobj\n")
    for number, content in objects.items(): emit(number, content)
    emit(5, b"<</Length %d/Filter/LZWDecode>>\rstream\r" % len(lzwed) + lzwed + b"\rendstream")
    emit(6, b"<</Length 10 0 R/Filter[/ASCII85Decode/FlateDecode]>>\nstream\r\n" + a85 + b"\r\nendstream")
    emit(9, b"<</Type/XObject/Subtype/Form/BBox[0 0 595 842]/Resources<</Font<</TT2 8 0 R>>>>/Length %d>>\nstream\n" % len(form) + form + b"\nendstream")
    emit(10, b"%d" % len(a85))
    xref = sum(map(len, body))
    body.append(b"xref\n0 11\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % offsets[i] for i in range(1, 11)))
    body.append(b"trailer\n<</Size 11/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % xref)
    open(os.path.join(OUT, name), "wb").write(b"".join(body))


if __name__ == "__main__":
    libreoffice(A338, "arera-338-2026-libreoffice-tagged.pdf")
    libreoffice(A343, "arera-343-2026-libreoffice-incremental.pdf"); incremental_update("arera-343-2026-libreoffice-incremental.pdf")
    resave(fpdf_type0(A338), "arera-338-2026-type0-objstm.pdf")
    resave(fpdf_type0(A343), "arera-343-2026-type0-objstm-aes256.pdf", encryption=pikepdf.Encryption(owner="synthetic-owner", user="", R=6, allow=pikepdf.Permissions(extract=False, modify_other=False)))
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
        reportlab_tide(temporary.name); resave(temporary.name, "terna-tide-2026q4-reportlab-aes128.pdf", encryption=pikepdf.Encryption(owner="synthetic-owner", user="", R=4, aes=True))
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
        reportlab_tide(temporary.name); resave(temporary.name, "terna-tide-2026q4-rc4.pdf", encryption=pikepdf.Encryption(owner="synthetic-owner", user="", R=3, aes=False, metadata=False))
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
        # A user password is needed to open it: the reader must say so instead of returning an empty text.
        reportlab_tide(temporary.name); resave(temporary.name, "terna-tide-2026q4-user-password.pdf", encryption=pikepdf.Encryption(owner="synthetic-owner", user="synthetic-user", R=4, aes=True))
    handcrafted("regulatory-features-handcrafted.pdf")
    for name in sorted(os.listdir(OUT)):
        if name.endswith(".pdf"): print(name, os.path.getsize(os.path.join(OUT, name)), file=sys.stderr)
