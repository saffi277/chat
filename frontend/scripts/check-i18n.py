"""
يتحقق من أن كل نص عربي في الواجهة له ترجمة إنجليزية في lib/i18n-en.ts.
الاستعمال (من مجلد frontend):  python3 scripts/check-i18n.py
يطبع النصوص الناقصة ويعيد رمز خطأ إن وُجدت (يصلح لـ CI).
"""
import glob
import re
import sys

AR = re.compile(r'[؀-ۿ]')
STR = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
# نصوص لا تُترجم عمداً: عناوين الصفحات في الخادم، واسم اللغة العربية على زر اللغة
SKIP = {'تسجيل الدخول | كلية الأسباط الجامعة', 'إنشاء حساب | كلية الأسباط الجامعة', 'التبديل إلى العربية',
        'العربية', 'تطبيق محادثات سريع وآمن'}


def strip_comments(src):
    src = re.sub(r'(image|video|audio)/\*', r'\1/X', src)  # "image/*" ليس تعليقاً
    src = re.sub(r'\{/\*.*?\*/\}', '', src, flags=re.S)
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$|(?<=[;,)}\]]) //.*$|(?<=\s)// .*$', '', src)


def used_texts():
    found = set()
    files = glob.glob('app/**/*.ts*', recursive=True) + glob.glob('lib/*.ts')
    for f in files:
        if 'i18n' in f:
            continue
        src = strip_comments(open(f, encoding='utf-8').read())
        for s in STR.findall(src):  # كل نص عربي بين علامتي تنصيص
            if AR.search(s):
                found.add(s.replace('\\"', '"'))
    return found - SKIP


def dictionary():
    src = open('lib/i18n-en.ts', encoding='utf-8').read()
    return {k.replace('\\"', '"') for k, _ in re.findall(r'^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",', src, re.M)}


missing = sorted(used_texts() - dictionary())
if missing:
    print(f'✖ {len(missing)} نص بلا ترجمة في lib/i18n-en.ts:')
    print('\n'.join('  ' + m for m in missing))
    sys.exit(1)
print('✔ كل النصوص مترجمة')
