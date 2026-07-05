from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing_view, name='landing'),
    path('global-chat/', views.global_chat_view, name='global_chat'),
    path('chat/<int:user_id>/', views.chat_view, name='chat'),
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('friend-request/send/<int:user_id>/', views.send_friend_request, name='send_friend_request'),
    path('friend-request/accept/<int:request_id>/', views.accept_friend_request, name='accept_friend_request'),
    path('friend-request/reject/<int:request_id>/', views.reject_friend_request, name='reject_friend_request'),
    path('unfriend/<int:user_id>/', views.unfriend, name='unfriend'),
    path('delete-chat/<int:user_id>/', views.delete_chat, name='delete_chat'),
    path('update-avatar/', views.update_avatar, name='update_avatar'),
    path('delete-message/<int:message_id>/', views.delete_message, name='delete_message'),
]
