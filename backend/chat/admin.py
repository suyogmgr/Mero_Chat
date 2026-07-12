from django.contrib import admin

from .models import ChatMessage, FriendRequest, OnlineUser, UserProfile

admin.site.register(ChatMessage)
admin.site.register(FriendRequest)
admin.site.register(OnlineUser)
admin.site.register(UserProfile)
