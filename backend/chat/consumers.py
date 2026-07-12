import json
import logging
from datetime import datetime
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import ChatMessage, FriendRequest, OnlineUser
from django.contrib.auth.models import User
from .crypto import encrypt, decrypt

logger = logging.getLogger(__name__)


@sync_to_async
def set_online_user(username, online):
    try:
        user = User.objects.get(username=username)
        if online:
            entry, created = OnlineUser.objects.get_or_create(user=user, defaults={'connections': 0})
            entry.connections += 1
            entry.save()
        else:
            entry = OnlineUser.objects.filter(user=user).first()
            if entry:
                entry.connections = max(0, entry.connections - 1)
                if entry.connections == 0:
                    entry.delete()
                else:
                    entry.save()
    except User.DoesNotExist:
        logger.warning(f"set_online_user: user {username} not found")
    except Exception as e:
        logger.error(f"set_online_user error: {e}")


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'
        self.username = self.scope['user'].username

        if self.scope['user'].is_anonymous:
            await self.close()
            return

        self.is_global = self.room_name == 'global'

        if self.is_global:
            self.other_username = None
            self.presence_group = None
        else:
            users = self.room_name.split('_')
            if self.username not in users:
                await self.close()
                return
            self.other_username = next(u for u in users if u != self.username)
            if not await self.are_friends(self.username, self.other_username):
                await self.close()
                return
            self.presence_group = f'presence_{self.other_username}'

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        if self.presence_group:
            await self.channel_layer.group_add(self.presence_group, self.channel_name)

        await self.accept()

        await self.set_online(True)
        await self.send_message_history()

        if self.presence_group:
            await self.channel_layer.group_send(
                self.presence_group, {
                    'type': 'presence_update',
                    'username': self.username,
                    'status': 'online'
                }
            )

    async def disconnect(self, close_code):
        await self.set_online(False)
        if getattr(self, 'presence_group', None):
            await self.channel_layer.group_send(
                self.presence_group, {
                    'type': 'presence_update',
                    'username': self.username,
                    'status': 'offline'
                }
            )
            await self.channel_layer.group_discard(self.presence_group, self.channel_name)

        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            msg_type = data.get('type', 'message')

            if msg_type == 'message':
                await self.handle_message(data)
            elif msg_type == 'typing':
                await self.handle_typing(data)
            elif msg_type == 'stop_typing':
                await self.handle_stop_typing(data)
            elif msg_type == 'read_receipt':
                await self.handle_read_receipt(data)
            elif msg_type == 'delete_message':
                await self.handle_delete_message(data)
        except Exception as e:
            print(f"Error in receive: {e}")

    async def handle_message(self, data):
        message = data.get('message', '').strip()
        if not message or len(message) > 5000000:
            await self.send(text_data=json.dumps({'error': 'Invalid message'}))
            return

        timestamp = datetime.now().isoformat()
        msg_id = await self.save_message(self.username, self.room_name, message)

        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'chat_message',
                'message': message,
                'username': self.username,
                'timestamp': timestamp,
                'msg_id': msg_id,
            }
        )

    async def handle_delete_message(self, data):
        msg_id = data.get('msg_id')
        if not msg_id:
            return
        deleted = await self.delete_message_db(msg_id, self.username)
        if deleted:
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'delete_message',
                    'msg_id': msg_id,
                }
            )

    async def handle_typing(self, data):
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'typing_indicator',
                'username': self.username,
            }
        )

    async def handle_stop_typing(self, data):
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'stop_typing_indicator',
                'username': self.username,
            }
        )

    async def handle_read_receipt(self, data):
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'read_receipt',
                'username': self.username,
            }
        )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message',
            'message': event['message'],
            'username': event['username'],
            'timestamp': event.get('timestamp'),
            'msg_id': event.get('msg_id'),
        }))

    async def delete_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'delete_message',
            'msg_id': event['msg_id'],
        }))

    async def typing_indicator(self, event):
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'username': event['username'],
        }))

    async def stop_typing_indicator(self, event):
        await self.send(text_data=json.dumps({
            'type': 'stop_typing',
            'username': event['username'],
        }))

    async def read_receipt(self, event):
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'username': event['username'],
        }))

    async def presence_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'presence',
            'username': event['username'],
            'status': event['status'],
        }))

    @sync_to_async
    def are_friends(self, username1, username2):
        try:
            return FriendRequest.objects.filter(
                sender__username=username1, receiver__username=username2, status='accepted'
            ).exists() or FriendRequest.objects.filter(
                sender__username=username2, receiver__username=username1, status='accepted'
            ).exists()
        except Exception as e:
            logger.error(f"are_friends error: {e}")
            return False

    async def set_online(self, online):
        await set_online_user(self.username, online)

    @sync_to_async
    def save_message(self, username, room, message):
        try:
            user = User.objects.get(username=username)
            msg = ChatMessage.objects.create(sender=user, room_name=room, content=encrypt(message))
            return msg.id
        except User.DoesNotExist:
            logger.warning(f"save_message: user {username} not found")
            return None
        except Exception as e:
            logger.error(f"save_message error: {e}")
            return None

    @sync_to_async
    def delete_message_db(self, msg_id, username):
        try:
            msg = ChatMessage.objects.get(id=msg_id)
            if msg.room_name == 'global':
                if msg.sender.username != username:
                    return False
            else:
                users = msg.room_name.split('_')
                if username not in users:
                    return False
            msg.delete()
            return True
        except ChatMessage.DoesNotExist:
            return False
        except Exception as e:
            logger.error(f"delete_message_db error: {e}")
            return False

    @sync_to_async
    def get_message_history(self):
        try:
            messages = ChatMessage.objects.filter(
                room_name=self.room_name
            ).order_by('timestamp')[:50]

            result = []
            for msg in messages:
                try:
                    plain = decrypt(msg.content)
                except Exception:
                    plain = "[encrypted message]"
                result.append({
                    'id': msg.id,
                    'message': plain,
                    'username': msg.sender.username,
                    'timestamp': msg.timestamp.isoformat()
                })
            return result
        except Exception as e:
            logger.error(f"get_message_history error: {e}")
            return []

    async def send_message_history(self):
        history = await self.get_message_history()
        await self.send(text_data=json.dumps({
            'type': 'history',
            'messages': history
        }))


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.username = self.scope['user'].username
        if self.scope['user'].is_anonymous:
            await self.close()
            return
        self.group_name = f'notifications_{self.username}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await set_online_user(self.username, True)

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        await set_online_user(self.username, False)

    async def receive(self, text_data):
        pass

    async def friend_request_notification(self, event):
        await self.send(text_data=json.dumps({
            'type': 'friend_request',
            'from': event['from'],
            'action': event['action'],
        }))
