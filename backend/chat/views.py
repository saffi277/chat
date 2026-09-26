from django.contrib.auth import get_user_model
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Conversation
from .serializers import ConversationSerializer, MessageSerializer
from .services import broadcast, create_message

User = get_user_model()


def my_conversation(request, pk):
    # نتأكد أن المستخدم مشارك بالمحادثة، وإلا 404 (ما نكشف وجودها)
    return get_object_or_404(Conversation, pk=pk, participants=request.user)


@api_view(['GET', 'POST'])
def conversations(request):
    if request.method == 'GET':
        qs = (request.user.conversations.prefetch_related('participants__profile')
              .annotate(last=Max('messages__created_at')).order_by('-last', '-created_at'))
        return Response(ConversationSerializer(qs, many=True, context={'request': request}).data)

    # POST {"user_id": 5} → نرجع المحادثة الموجودة أو ننشئ وحدة جديدة
    other = get_object_or_404(User, pk=request.data.get('user_id'))
    if other == request.user:
        return Response({'detail': 'ما تكدر تحچي ويا نفسك'}, status=status.HTTP_400_BAD_REQUEST)
    # filter مرتين = JOIN مرتين: محادثة فيها أنا وفيها هو
    conv = Conversation.objects.filter(participants=request.user).filter(participants=other).first()
    created = conv is None
    if created:
        conv = Conversation.objects.create()
        conv.participants.add(request.user, other)
    data = ConversationSerializer(conv, context={'request': request}).data
    return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def messages(request, pk):
    conv = my_conversation(request, pk)
    if request.method == 'GET':
        # SQL تقريباً: SELECT * FROM chat_message WHERE conversation_id = pk ORDER BY created_at
        return Response(MessageSerializer(conv.messages.select_related('sender__profile'), many=True).data)

    content = (request.data.get('content') or '').strip()
    if not content:
        return Response({'detail': 'الرسالة فارغة'}, status=status.HTTP_400_BAD_REQUEST)
    data = create_message(conv, request.user, content)
    broadcast(conv.id, {'type': 'message', 'message': data})
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
def mark_read(request, pk):
    """PATCH: نعلّم كل رسائل الطرف الثاني بهاي المحادثة كمقروءة."""
    conv = my_conversation(request, pk)
    count = conv.messages.filter(is_read=False).exclude(sender=request.user).update(is_read=True)
    if count:
        broadcast(conv.id, {'type': 'read', 'reader_id': request.user.id})
    return Response({'updated': count})
