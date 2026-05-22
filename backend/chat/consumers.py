import json
from datetime import datetime
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import ChatMessage
from django.contrib.auth.models import User


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'
        self.username = self.scope['user'].username

        if self.scope['user'].is_anonymous:
            await self.close()
            return

        users = self.room_name.split('_')
        if self.username not in users:
            await self.close()
            return

        self.other_username = next(u for u in users if u != self.username)
        self.presence_group = f'presence_{self.other_username}'

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.channel_layer.group_add(self.presence_group, self.channel_name)
        await self.accept()

        await self.send_message_history()

        await self.channel_layer.group_send(
            self.presence_group, {
                'type': 'presence_update',
                'username': self.username,
                'status': 'online'
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, 'presence_group'):
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
        except Exception as e:
            print(f"Error in receive: {e}")

    async def handle_message(self, data):
        message = data.get('message', '').strip()
        if not message or len(message) > 1000:
            await self.send(text_data=json.dumps({'error': 'Invalid message'}))
            return

        timestamp = datetime.now().isoformat()
        await self.save_message(self.username, self.room_name, message)

        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'chat_message',
                'message': message,
                'username': self.username,
                'timestamp': timestamp,
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
    def save_message(self, username, room, message):
        try:
            user = User.objects.get(username=username)
            ChatMessage.objects.create(sender=user, room_name=room, content=message)
            return True
        except User.DoesNotExist:
            return False

    @sync_to_async
    def get_message_history(self):
        messages = ChatMessage.objects.filter(
            room_name=self.room_name
        ).order_by('timestamp')[:50]

        return [
            {
                'message': msg.content,
                'username': msg.sender.username,
                'timestamp': msg.timestamp.isoformat()
            }
            for msg in messages
        ]

    async def send_message_history(self):
        history = await self.get_message_history()
        await self.send(text_data=json.dumps({
            'type': 'history',
            'messages': history
        }))
