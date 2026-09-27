# Serializer = يحول بين كائن Python و JSON (بالاتجاهين) ويتحقق من البيانات
from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Profile

User = get_user_model()


def profile_of(user):
    # المستخدمين المسوين من createsuperuser ممكن ما عدهم Profile
    return getattr(user, 'profile', None) or Profile(user=user)


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'display_name', 'avatar', 'is_online', 'last_seen', 'date_joined']

    def get_display_name(self, user):
        return profile_of(user).display_name or user.username

    def get_avatar(self, user):
        # نرجع المسار بس (/media/avatars/x.png)، والواجهة تضيف عليه عنوان السيرفر
        avatar = profile_of(user).avatar
        return avatar.url if avatar else None

    def get_is_online(self, user):
        return profile_of(user).is_online

    def get_last_seen(self, user):
        last_seen = profile_of(user).last_seen
        return last_seen.isoformat() if last_seen else None


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    display_name = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=50)

    class Meta:
        model = User
        fields = ['id', 'username', 'password', 'display_name']

    def create(self, validated_data):
        display_name = validated_data.pop('display_name', '').strip()
        # create_user يشفّر (hash) الباسورد، ما نخزنه نص عادي أبداً
        user = User.objects.create_user(**validated_data)
        Profile.objects.create(user=user, display_name=display_name)
        return user


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """PATCH /api/auth/me/ — تعديل الاسم الظاهر والصورة."""

    class Meta:
        model = Profile
        fields = ['display_name', 'avatar']

    def validate_display_name(self, value):
        return value.strip()

    def validate_avatar(self, value):
        if value and value.size > 3 * 1024 * 1024:
            raise serializers.ValidationError('الصورة لازم تكون أصغر من 3 ميگا')
        return value
