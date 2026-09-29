"""
صور الاختبار تُولَّد عند التشغيل (لا نحفظ صوراً كبيرة في المستودع) من صورة الكلية الموجودة في الواجهة.
الاستعمال: python fixtures.py <مجلد الإخراج>   (يحتاج Pillow، وهو من متطلبات الخادم أصلاً)
"""
import sys
from pathlib import Path

from PIL import Image

out = Path(sys.argv[1])
(out / 'ui').mkdir(parents=True, exist_ok=True)
(out / 'seed').mkdir(parents=True, exist_ok=True)
photo = Image.open(Path(__file__).resolve().parents[2] / 'public/brand/campus-day.webp').convert('RGB')
photo.save(out / 'ui/wide.jpg', quality=92)                          # 2560×1441: رفع بطيء مع نسبة التقدّم
photo.crop((900, 0, 1700, 1441)).save(out / 'ui/tall.jpg', quality=92)  # 800×1441: صورة طولية في العارض
photo.resize((640, 360)).save(out / 'seed/sunset.jpg', quality=85)   # صورة صغيرة لاختبار الإرسال مع تعليق
print('fixtures ready in', out)
