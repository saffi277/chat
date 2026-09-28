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
    # الدور بالجامعة: ينحفظ بالتسجيل، وبالدخول لازم يطابق اللي اختاره
    STUDENT, FACULTY, STAFF = 'student', 'faculty', 'staff'
    ROLES = [(STUDENT, 'طالب'), (FACULTY, 'تدريسي'), (STAFF, 'إداري')]
    role = models.CharField(max_length=10, choices=ROLES, default=STUDENT)
    # الرقم الجامعي (اختياري). يكدر يدخل بيه بدل اسم المستخدم
    university_id = models.CharField(max_length=30, blank=True, db_index=True)
    # الوضع: نهاري/ليلي (مو ثيم). والثيم (شكل التطبيق) شي منفصل، نضيف ثيمات بعدين
    MODES = [('light', 'نهاري'), ('dark', 'ليلي'), ('system', 'تلقائي')]
    mode = models.CharField(max_length=10, choices=MODES, default='system')
    THEMES = [('default', 'الأساسي')]
    theme = models.CharField(max_length=20, choices=THEMES, default='default')
    # إخفاء نص الرسالة بالإشعار (يطلع "رسالة جديدة" بس): للي يخاف أحد يشوف شاشة موبايله
    hide_preview = models.BooleanField(default=False)
    is_online = models.BooleanField(default=False)
    # كم تبويب/جهاز فاتح هسه. "غير متصل" بس لما يصير صفر
    connections = models.IntegerField(default=0)
    last_seen = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'{self.user.username} profile'


class SupportRequest(models.Model):
    """طلبات "نسيت كلمة المرور" و"الدعم الفني" من صفحة الدخول. الإداري يشوفها بلوحة الإدارة (/admin)."""

    PASSWORD, SUPPORT = 'password', 'support'
    KINDS = [(PASSWORD, 'نسيت كلمة المرور'), (SUPPORT, 'دعم فني')]

    kind = models.CharField(max_length=10, choices=KINDS)
    identifier = models.CharField('البريد أو الرقم الجامعي', max_length=150, blank=True)
    contact = models.CharField('وسيلة التواصل', max_length=150, blank=True)
    message = models.TextField('الرسالة', blank=True)
    # إذا لگينا الحساب من الـ identifier نربطه، حتى الإداري يعرف منو
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    handled = models.BooleanField('تم الحل', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['handled', '-created_at']
        verbose_name = 'طلب مساعدة'
        verbose_name_plural = 'طلبات المساعدة'

    def __str__(self):
        return f'{self.get_kind_display()}: {self.identifier or self.contact}'


class AuthToken(models.Model):
    """
    توكن الدخول. ما نخزن التوكن نفسه، بس الـ hash مالته (SHA-256):
    إذا أحد سرق قاعدة البيانات ما يكدر يستخدمها حتى يدخل بحسابات الناس (نفس فكرة كلمات المرور).
    كل جهاز إله توكن، وتسجيل الخروج يمسح توكن هذا الجهاز بس.
    """

    key_hash = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='auth_tokens')
    created = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)
    user_agent = models.CharField(max_length=200, blank=True)

    class Meta:
        verbose_name = 'جلسة دخول'
        verbose_name_plural = 'جلسات الدخول'

    def __str__(self):
        return f'{self.user} ({self.created:%Y-%m-%d})'
