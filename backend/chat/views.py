import json

from django.shortcuts import redirect, render, get_object_or_404
from django.contrib.auth.models import User
from django.contrib.auth import login, authenticate, logout
from django.contrib.auth.forms import UserCreationForm
from django.contrib import messages
from django_ratelimit.decorators import ratelimit
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.db import models
from django.utils.http import url_has_allowed_host_and_scheme
from chat.models import ChatMessage, FriendRequest, OnlineUser, UserProfile


def get_friend_status(request_user, target_user):
    if request_user == target_user:
        return 'self'
    sent = FriendRequest.objects.filter(sender=request_user, receiver=target_user).first()
    if sent:
        return sent.status if sent.status == 'accepted' else 'sent_pending'
    received = FriendRequest.objects.filter(sender=target_user, receiver=request_user).first()
    if received:
        return 'accepted' if received.status == 'accepted' else 'received_pending'
    return 'none'


def get_friends(user):
    sent = FriendRequest.objects.filter(sender=user, status='accepted').values_list('receiver', flat=True)
    received = FriendRequest.objects.filter(receiver=user, status='accepted').values_list('sender', flat=True)
    friend_ids = list(sent) + list(received)
    return User.objects.filter(id__in=friend_ids)


@login_required(login_url='login')
def landing_view(request):
    users = User.objects.exclude(username=request.user.username)
    user_list = []
    for u in users:
        status = get_friend_status(request.user, u)
        avatar = get_avatar_url(u)
        info = {
            'id': u.id,
            'username': u.username,
            'avatar': avatar,
            'is_online': OnlineUser.objects.filter(user=u).exists(),
            'friend_status': status,
        }
        if status == 'received_pending':
            req = FriendRequest.objects.filter(sender=u, receiver=request.user, status='pending').first()
            info['request_id'] = req.id if req else None
        user_list.append(info)

    pending_requests = FriendRequest.objects.filter(receiver=request.user, status='pending')
    my_avatar = get_avatar_url(request.user)

    return render(request, 'landing.html', {
        'users': user_list,
        'pending_requests': pending_requests,
        'my_avatar': my_avatar or f"https://api.dicebear.com/7.x/thumbs/svg?seed={request.user.username}",
    })


@login_required(login_url='login')
def global_chat_view(request):
    friends = get_friends(request.user)
    contact_list = []

    for user in friends:
        room_name = '_'.join(sorted([request.user.username, user.username]))
        last_msg = ChatMessage.objects.filter(room_name=room_name).order_by('-timestamp').first()
        avatar = get_avatar_url(user)
        contact_list.append({
            "id": user.id,
            "name": user.username,
            "avatar": avatar or f"https://api.dicebear.com/7.x/thumbs/svg?seed={user.username}",
            "status": "Online" if OnlineUser.objects.filter(user=user).exists() else "Offline",
            "lastMessage": last_msg.content if last_msg else "No messages yet",
            "message": [],
            "time": "",
            "unread": 0,
        })

    return render(request, 'index.html', {
        'contacts_json': json.dumps(contact_list),
        'selected_user_id': 0,
        'my_avatar': get_avatar_url(request.user) or f"https://api.dicebear.com/7.x/thumbs/svg?seed={request.user.username}",
    })


@login_required(login_url='login')
def chat_view(request, user_id):
    friends = get_friends(request.user)
    target = get_object_or_404(User, id=user_id)

    if target not in friends and target != request.user:
        messages.error(request, 'You must be friends to chat.')
        return redirect('landing')

    contact_list = []

    for user in friends:
        room_name = '_'.join(sorted([request.user.username, user.username]))
        last_msg = ChatMessage.objects.filter(room_name=room_name).order_by('-timestamp').first()
        avatar = get_avatar_url(user)

        contact_list.append({
            "id": user.id,
            "name": user.username,
            "avatar": avatar or f"https://api.dicebear.com/7.x/thumbs/svg?seed={user.username}",
            "status": "Online" if OnlineUser.objects.filter(user=user).exists() else "Offline",
            "lastMessage": last_msg.content if last_msg else "No messages yet",
            "message": [],
            "time": "",
            "unread": 0,
        })

    return render(request, 'index.html', {
        'contacts_json': json.dumps(contact_list),
        'selected_user_id': user_id,
        'my_avatar': get_avatar_url(request.user) or f"https://api.dicebear.com/7.x/thumbs/svg?seed={request.user.username}",
    })


@login_required(login_url='login')
def send_friend_request(request, user_id):
    receiver = get_object_or_404(User, id=user_id)
    if receiver == request.user:
        return JsonResponse({'error': 'Cannot send request to yourself'}, status=400)

    existing = FriendRequest.objects.filter(
        models.Q(sender=request.user, receiver=receiver) |
        models.Q(sender=receiver, receiver=request.user)
    ).first()

    if existing:
        if existing.status == 'accepted':
            return JsonResponse({'error': 'Already friends'}, status=400)
        if existing.status == 'pending':
            return JsonResponse({'error': 'Request already sent'}, status=400)
        existing.delete()

    FriendRequest.objects.create(sender=request.user, receiver=receiver)
    return JsonResponse({'success': 'Friend request sent'})


@login_required(login_url='login')
def accept_friend_request(request, request_id):
    req = get_object_or_404(FriendRequest, id=request_id, receiver=request.user, status='pending')
    req.status = 'accepted'
    req.save()
    return JsonResponse({'success': 'Friend request accepted'})


@login_required(login_url='login')
def reject_friend_request(request, request_id):
    req = get_object_or_404(FriendRequest, id=request_id, receiver=request.user, status='pending')
    req.status = 'rejected'
    req.save()
    return JsonResponse({'success': 'Friend request rejected'})


@login_required(login_url='login')
def unfriend(request, user_id):
    target = get_object_or_404(User, id=user_id)
    FriendRequest.objects.filter(
        models.Q(sender=request.user, receiver=target, status='accepted') |
        models.Q(sender=target, receiver=request.user, status='accepted')
    ).delete()
    return JsonResponse({'success': 'Unfriended'})


@login_required(login_url='login')
def delete_chat(request, user_id):
    target = get_object_or_404(User, id=user_id)
    room_name = '_'.join(sorted([request.user.username, target.username]))
    ChatMessage.objects.filter(room_name=room_name).delete()
    return JsonResponse({'success': 'Chat deleted'})


@login_required(login_url='login')
def delete_message(request, message_id):
    msg = get_object_or_404(ChatMessage, id=message_id)
    if msg.room_name == 'global':
        if msg.sender != request.user:
            return JsonResponse({'error': 'Unauthorized'}, status=403)
    else:
        room_users = msg.room_name.split('_')
        if request.user.username not in room_users:
            return JsonResponse({'error': 'Unauthorized'}, status=403)
    msg.delete()
    return JsonResponse({'success': 'Message deleted'})


@login_required(login_url='login')
def update_avatar(request):
    if request.method == 'POST':
        url = request.POST.get('avatar_url', '').strip()
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        profile.avatar_url = url
        profile.save()
        return JsonResponse({'success': True, 'avatar_url': url})
    return JsonResponse({'error': 'POST required'}, status=405)


def get_avatar_url(user):
    try:
        url = user.profile.avatar_url
        return url if url else None
    except UserProfile.DoesNotExist:
        return None


@ratelimit(key='ip', rate='3/m', method='POST')
def register_view(request):
    if getattr(request, 'limited', False):
        return render(request, "register.html", {"error": "Too many attempts. Try again in a minute."})
    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            email = request.POST.get("email", "")
            if email:
                user.email = email
                user.save()
            UserProfile.objects.create(user=user)
            login(request, user)
            return redirect("landing")
    else:
        form = UserCreationForm()

    return render(request, "register.html", {"form": form})


@ratelimit(key='ip', rate='5/m', method='POST')
def login_view(request):
    if getattr(request, 'limited', False):
        return render(request, "login.html", {"error": "Too many attempts. Try again in a minute."})
    if request.user.is_authenticated:
        return redirect('landing')

    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")
        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)
            messages.success(request, f"Welcome back, {username}!")
            next_url = request.GET.get('next')
            if next_url and url_has_allowed_host_and_scheme(url=next_url, allowed_hosts={request.get_host()}):
                return redirect(next_url)
            return redirect('landing')
        else:
            messages.error(request, "Invalid username or password")

    return render(request, "login.html")


@login_required(login_url='login')
def logout_view(request):
    logout(request)
    messages.success(request, "You have been logged out.")
    return redirect('login')
