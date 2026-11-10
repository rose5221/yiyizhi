import sys, os
from pypdf import PdfReader

src, out = sys.argv[1], sys.argv[2]
r = PdfReader(src)
with open(out, 'w', encoding='utf-8') as f:
    for i, p in enumerate(r.pages):
        f.write('\n<<<PAGE %d>>>\n' % (i + 1))
        f.write(p.extract_text() or '')
print(out, len(r.pages), os.path.getsize(out))
