"""
يحوّل ملفات الترجمة ‎.po‎ إلى ‎.mo‎ (الصيغة التي يقرؤها Django) دون الحاجة إلى تثبيت GNU gettext.
الاستعمال (من مجلد backend):  python locale/compile.py
"""
import ast
import struct
from pathlib import Path


def parse_po(path):
    """يقرأ أزواج msgid/msgstr (نصوص في سطر واحد أو عدة أسطر)."""
    entries, key, current = {}, None, None
    for line in Path(path).read_text(encoding='utf-8').splitlines() + ['']:
        line = line.strip()
        if line.startswith('msgid '):
            if key is not None:
                entries[key] = current
            key, current = ast.literal_eval(line[6:]), None
        elif line.startswith('msgstr '):
            current = ast.literal_eval(line[7:])
        elif line.startswith('"'):
            if current is None:
                key += ast.literal_eval(line)
            else:
                current += ast.literal_eval(line)
    if key is not None:
        entries[key] = current
    return entries


def write_mo(entries, path):
    """صيغة GNU ‎.mo‎: ترويسة، ثم جدولا (الطول، الموضع) للأصل والترجمة، ثم النصوص."""
    keys = sorted(entries)
    ids = b''.join(k.encode('utf-8') + b'\0' for k in keys)
    strs = b''.join(entries[k].encode('utf-8') + b'\0' for k in keys)
    n = len(keys)
    start = 7 * 4 + 16 * n
    offsets, o = [], 0
    for k in keys:
        offsets.append((len(k.encode('utf-8')), start + o))
        o += len(k.encode('utf-8')) + 1
    t_offsets, o = [], 0
    for k in keys:
        t_offsets.append((len(entries[k].encode('utf-8')), start + len(ids) + o))
        o += len(entries[k].encode('utf-8')) + 1
    header = struct.pack('Iiiiiii', 0x950412de, 0, n, 7 * 4, 7 * 4 + 8 * n, 0, 0)
    table = b''.join(struct.pack('ii', *x) for x in offsets) + b''.join(struct.pack('ii', *x) for x in t_offsets)
    Path(path).write_bytes(header + table + ids + strs)


if __name__ == '__main__':
    for po in Path(__file__).parent.glob('*/LC_MESSAGES/*.po'):
        write_mo(parse_po(po), po.with_suffix('.mo'))
        print('✔', po.with_suffix('.mo'))
