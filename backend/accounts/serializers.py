# Serializer = يحول بين كائن Python و JSON (بالاتجاهين) ويتحقق من البيانات
from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    is_online = serializers.BooleanField(source='profile.is_online', read_only=True)
    last_seen = serializers.DateTimeField(source='profile.last_seen', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'is_online', 'last_seen']


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ['id', 'username', 'password']

    def create(self, validated_data):
        # create_user يشفّر (hash) الباسورد، ما نخزنه نص عادي أبداً
        return User.objects.create_user(**validated_data)
