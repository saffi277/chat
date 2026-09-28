import re

from django.db.models import Count, Exists, OuterRef
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.serializers import UserSerializer
from chat.media import validate_upload
from chat.services import send_to_contacts, send_to_users
from config.media import signed_url

from .models import Story, StoryView


class StorySerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    views_count = serializers.IntegerField(read_only=True, default=0)
    seen = serializers.BooleanField(read_only=True, default=False)

    class Meta:
        model = Story
        fields = ['id', 'kind', 'file_url', 'text', 'background', 'duration', 'created_at', 'expires_at',
                  'views_count', 'seen']

    def get_file_url(self, obj):
        return signed_url(obj.file.name) if obj.file else None  # موقّع ومؤقت


def active_stories(request):
    return (Story.objects.filter(expires_at__gt=timezone.now()).select_related('user__profile')
            .annotate(views_count=Count('views'),
                      seen=Exists(StoryView.objects.filter(story=OuterRef('pk'), viewer=request.user))))


@api_view(['GET', 'POST'])
def stories(request):
    if request.method == 'GET':
        """
        حالات آخر 24 ساعة مجمعة حسب الشخص: حالاتي أول، وبعدها اللي بيهم شي ما شفته،
        وبعدها اللي شفتها كلها. ?kind=image|video|text للفلترة (تبويبات الصور/الفيديو).
        """
        qs = active_stories(request)
        if request.query_params.get('kind'):
            qs = qs.filter(kind=request.query_params['kind'])
        groups = {}
        for story in qs:
            groups.setdefault(story.user_id, {'user': story.user, 'stories': []})['stories'].append(story)
        result = []
        for uid, g in groups.items():
            is_me = uid == request.user.id
            all_seen = all(st.seen for st in g['stories'])
            latest = max(st.created_at for st in g['stories'])
            result.append(((not is_me, all_seen, -latest.timestamp()), {
                'user': UserSerializer(g['user']).data, 'is_me': is_me, 'all_seen': all_seen,
                'stories': StorySerializer(g['stories'], many=True).data}))
        return Response([item for _key, item in sorted(result, key=lambda r: r[0])])

    # POST: multipart file=<صورة/فيديو> + text اختياري، أو JSON {"kind": "text", "text": "...", "background": "#hex"}
    upload = request.FILES.get('file')
    text = (request.data.get('text') or '').strip()[:500]
    if upload:
        kind = 'video' if (upload.content_type or '').startswith('video/') else 'image'
        validate_upload(kind, upload)
        story = Story.objects.create(user=request.user, kind=kind, file=upload, text=text,
                                     duration=request.data.get('duration') or None)
    else:
        if not text:
            raise ValidationError({'text': _('الحالة فارغة')})
        background = request.data.get('background') or '#5b5cf0'
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', background):
            raise ValidationError({'background': _('لون بصيغة #RRGGBB')})
        story = Story.objects.create(user=request.user, kind=Story.TEXT, text=text, background=background)
    # نبلغ المتصلين حتى تطلع الحلقة الملونة حول صورته
    send_to_contacts(request.user.id, {'type': 'story', 'user_id': request.user.id})
    return Response(StorySerializer(story).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
def story_detail(request, pk):
    story = get_object_or_404(Story, pk=pk, user=request.user)
    if story.file:
        story.file.delete(save=False)
    story.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
def view_story(request, pk):
    story = get_object_or_404(Story, pk=pk, expires_at__gt=timezone.now())
    if story.user_id != request.user.id:
        _view, created = StoryView.objects.get_or_create(story=story, viewer=request.user)
        if created:
            send_to_users([story.user_id], {'type': 'story_viewed', 'story_id': story.id, 'viewer_id': request.user.id})
    return Response({'ok': True})


@api_view(['GET'])
def story_viewers(request, pk):
    """صاحب الحالة بس يشوف منو شافها."""
    story = get_object_or_404(Story, pk=pk, user=request.user)
    views = story.views.select_related('viewer__profile').order_by('-viewed_at')
    return Response([{'user': UserSerializer(v.viewer).data, 'viewed_at': v.viewed_at} for v in views])

