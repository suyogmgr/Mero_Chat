import base64
import hashlib
from cryptography.fernet import Fernet
from django.conf import settings

PREFIX = "$enc$"

def _get_fernet():
    key = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))

def encrypt(content):
    token = _get_fernet().encrypt(content.encode())
    return PREFIX + token.decode()

def decrypt(content):
    if not content.startswith(PREFIX):
        return content
    return _get_fernet().decrypt(content[len(PREFIX):].encode()).decode()
