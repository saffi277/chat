from django.conf import settings
from django.db import models


class Profile(models.Model):
    """معلومات إضافية لكل مستخدم. جدول users الأساسي يجي جاهز من Django."""

    # OneToOne = كل مستخدم إله Profile واحد بس (Foreign Key فريد)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile')
    # الاسم اللي يشوفه الناس. يقبل فراغ وعربي، بعكس username اللي هو للدخول بس
    display_name = models.CharField(max_length=50, blank=True)
    # الصورة تنحفظ كملف بـ MEDIA_ROOT/avatars، والداتابيس تحفظ بس مسارها
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    # للتواصل (تطلع بصفحة جهة الاتصال)
    phone = models.CharField(max_length=20, blank=True)
    bio = models.CharField(max_length=140, blank=True)  # "حول"
    city = models.CharField(max_length=60, blank=True)
    # شكل الواجهة اللي اختاره: الزجاجي الفاتح، أو الداكن الفاخر
    THEMES = [('glass', 'النموذج الزجاجي'), ('dark', 'النموذج الداكن'), ('system', 'حسب الجهاز')]
    theme = models.CharField(max_length=10, choices=THEMES, default='system')
    is_online = models.BooleanField(default=False)
    # كم تبويب/جهاز فاتح هسه. "غير متصل" بس لما يصير صفر
    connections = models.IntegerField(default=0)
    last_seen = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'{self.user.username} profile'
