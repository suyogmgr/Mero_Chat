from django.contrib import admin

from .models import ChatMessage, OnlineUser, UserProfile

admin.site.register(ChatMessage)
admin.site.register(OnlineUser)
admin.site.register(UserProfile)
