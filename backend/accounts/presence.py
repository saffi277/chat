from django.db import DatabaseError


def reset_presence():
    """ماكو أي اتصال مفتوح (السيرفر توه اشتغل): نصفّر العدادات حتى محد يبقى "متصل" غلط."""
    from .models import Profile
    try:
        return Profile.objects.filter(connections__gt=0).update(connections=0, is_online=False)
    except DatabaseError:
        return 0  # الجداول بعد ما انسوت (قبل migrate)
