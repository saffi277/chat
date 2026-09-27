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
    bio = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    city = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'display_name', 'avatar', 'bio', 'phone', 'city',
                  'is_online', 'last_seen', 'date_joined', 'role']

    def get_display_name(self, user):
        return profile_of(user).display_name or user.username

    def get_avatar(self, user):
        # نرجع المسار بس (/media/avatars/x.png)، والواجهة تضيف عليه عنوان السيرفر
        avatar = profile_of(user).avatar
        return avatar.url if avatar else None

    def get_bio(self, user):
        return profile_of(user).bio

    def get_phone(self, user):
        return profile_of(user).phone

    def get_city(self, user):
        return profile_of(user).city

    def get_is_online(self, user):
        return profile_of(user).is_online

    def get_role(self, user):
        return profile_of(user).role

    def get_last_seen(self, user):
        last_seen = profile_of(user).last_seen
        return last_seen.isoformat() if last_seen else None


class MeSerializer(UserSerializer):
    """معلوماتي أنا: نفس المستخدم + إعداداتي الخاصة."""

    mode = serializers.SerializerMethodField()
    theme = serializers.SerializerMethodField()
    university_id = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        # البريد والرقم الجامعي خاصين: يطلعن إلي بس، مو للناس
        fields = UserSerializer.Meta.fields + ['mode', 'theme', 'email', 'university_id']

    def get_university_id(self, user):
        return profile_of(user).university_id

    def get_mode(self, user):
        return profile_of(user).mode

    def get_theme(self, user):
        return profile_of(user).theme


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    display_name = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=50)
    role = serializers.ChoiceField(choices=Profile.ROLES, default=Profile.STUDENT, write_only=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    university_id = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=30)

    class Meta:
        model = User
        fields = ['id', 'username', 'password', 'display_name', 'role', 'email', 'university_id']

    def validate_email(self, value):
        value = value.strip().lower()
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('هذا البريد مسجل بحساب ثاني')
        return value

    def validate_university_id(self, value):
        value = value.strip()
        if value and Profile.objects.filter(university_id__iexact=value).exists():
            raise serializers.ValidationError('هذا الرقم الجامعي مسجل بحساب ثاني')
        return value

    def create(self, validated_data):
        display_name = validated_data.pop('display_name', '').strip()
        role = validated_data.pop('role', Profile.STUDENT)
        university_id = validated_data.pop('university_id', '')
        # create_user يشفّر (hash) الباسورد، ما نخزنه نص عادي أبداً
        user = User.objects.create_user(**validated_data)
        Profile.objects.create(user=user, display_name=display_name, role=role, university_id=university_id)
        return user


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """PATCH /api/auth/me/ — تعديل الاسم الظاهر والصورة."""

    class Meta:
        model = Profile
        fields = ['display_name', 'avatar', 'bio', 'phone', 'city', 'mode', 'theme']

    def validate_display_name(self, value):
        return value.strip()

    def validate_phone(self, value):
        value = value.strip().replace(' ', '')
        if value and not value.lstrip('+').isdigit():
            raise serializers.ValidationError('رقم الهاتف أرقام بس (ويجوز + بالبداية)')
        return value

    def validate_avatar(self, value):
        if value and value.size > 3 * 1024 * 1024:
            raise serializers.ValidationError('الصورة لازم تكون أصغر من 3 ميگا')
        return value
