from django.conf import settings
from django.db import models


class Call(models.Model):
    """
    سجل المكالمة. الصوت/الصورة نفسها ما تمر من سيرفرنا: تنتقل مباشرة بين الجهازين
    (WebRTC). السيرفر بس يرن ويوصّل "رسائل التعارف" (signaling) بين الطرفين.
    """

    AUDIO, VIDEO = 'audio', 'video'
    RINGING, ONGOING, ENDED, MISSED, DECLINED = 'ringing', 'ongoing', 'ended', 'missed', 'declined'
    STATUSES = [(RINGING, 'يرن'), (ONGOING, 'جارية'), (ENDED, 'انتهت'), (MISSED, 'فائتة'), (DECLINED, 'مرفوضة')]

    conversation = models.ForeignKey('chat.Conversation', on_delete=models.CASCADE, related_name='calls')
    caller = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='calls_made')
    kind = models.CharField(max_length=10, choices=[(AUDIO, 'صوتية'), (VIDEO, 'فيديو')], default=AUDIO)
    status = models.CharField(max_length=10, choices=STATUSES, default=RINGING)
    joined = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='calls_joined', blank=True)
    # من أُضيف إلى المكالمة أثناءها وليس عضواً في محادثتها (مثل «إضافة» في واتساب): يرنّ عنده ويستطيع الانضمام
    invited = models.ManyToManyField(settings.AUTH_USER_MODEL, through='CallInvite', through_fields=('call', 'user'),
                                     related_name='calls_invited', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    @property
    def duration(self):
        if self.answered_at and self.ended_at:
            return round((self.ended_at - self.answered_at).total_seconds())
        return None


class CallInvite(models.Model):
    """دعوة شخص إلى مكالمة جارية: من دعاه ومتى (يتوقف الرنين عنده بعد دقيقة)."""

    call = models.ForeignKey(Call, on_delete=models.CASCADE, related_name='invites')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='call_invites')
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    created_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['call', 'user'], name='call_invite_once')]
