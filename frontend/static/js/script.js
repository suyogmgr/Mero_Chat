function isImage(url) {
  return url && (url.startsWith('data:image/') || url.match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i));
}

function getRoomName(user1, user2) {
  if (user2 === "Global Chat") return "global";
  return [user1, user2].sort().join('_');
}

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = src;
  lb.classList.remove('hidden');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
}

function initialsAvatar(img, name) {
  if (!name || name === '?') return;
  const colors = ['#2563eb','#7c3aed','#db2777','#dc2626','#ea580c','#ca8a04','#16a34a','#0891b2'];
  const c = colors[name.length % colors.length];
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="${c}"/><text x="24" y="24" text-anchor="middle" dominant-baseline="central" fill="white" font-size="18" font-weight="600" font-family="sans-serif">${initials}</text></svg>`;
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

let chatSocket = null;
let typingTimer = null;
let isTyping = false;

const contacts = dbContacts.length > 0 ? dbContacts : [
  { id: 0, name: "System", avatar: "", message: [] }
];

let activeContact = contacts[0];

function updateStatusDot(state) {
  const dot = document.getElementById('ws-status-dot');
  if (!dot) return;
  const statuses = {
    0: { color: 'bg-yellow-500', title: 'Connecting...' },
    1: { color: 'bg-green-500', title: 'Connected' },
    2: { color: 'bg-yellow-500', title: 'Closing...' },
    3: { color: 'bg-red-500', title: 'Disconnected' },
  };
  const s = statuses[state] || statuses[3];
  dot.className = `inline-block w-2.5 h-2.5 rounded-full ${s.color} shadow-sm`;
  dot.title = s.title;
}

function connectToRoom(contactName) {
  if (chatSocket) chatSocket.close();

  const roomName = getRoomName(currentUserName, contactName);
  chatSocket = new WebSocket('ws://' + window.location.host + '/ws/chat/' + roomName + '/');

  chatSocket.onopen = () => updateStatusDot(chatSocket.readyState);

  chatSocket.onclose = (e) => {
    updateStatusDot(3);
    if (e.code !== 1000) console.error("WebSocket closed unexpectedly:", e.code, e.reason);
  };

  chatSocket.onerror = () => updateStatusDot(3);

  chatSocket.onmessage = function(e) {
    const data = JSON.parse(e.data);

    switch (data.type) {
      case 'history':
        activeContact.message = data.messages.map(m => ({
          id: m.id,
          from: m.username === currentUserName ? "me" : "them",
          text: m.message,
          time: formatTime(m.timestamp),
        }));
        renderChat();
        renderContacts();
        sendReadReceipt();
        break;

      case 'message':
        activeContact.message.push({
          id: data.msg_id,
          from: data.username === currentUserName ? "me" : "them",
          text: data.message,
          time: formatTime(data.timestamp),
        });
        renderChat();
        renderContacts();
        if (data.username !== currentUserName) {
          if (!document.hasFocus()) playNotification();
          sendReadReceipt();
        }
        break;

      case 'delete_message':
        const idx = activeContact.message.findIndex(m => m.id === data.msg_id);
        if (idx !== -1) {
          activeContact.message.splice(idx, 1);
          renderChat();
          renderContacts();
        }
        break;

      case 'typing':
        if (data.username !== currentUserName) showTyping(data.username);
        break;

      case 'stop_typing':
        if (data.username !== currentUserName) hideTyping();
        break;

      case 'presence':
        updateContactPresence(data.username, data.status);
        break;

      case 'read_receipt':
        if (data.username !== currentUserName) {
          for (let i = activeContact.message.length - 1; i >= 0; i--) {
            if (activeContact.message[i].from === "me") {
              activeContact.message[i].seen = true;
              break;
            }
          }
          renderChat();
        }
        break;
    }
  };
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return time;
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${time}`;
}

function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

function updateContactPresence(username, status) {
  const c = contacts.find(c => c.name === username);
  if (c) {
    c.status = status === 'online' ? 'Online' : 'Offline';
    if (activeContact && activeContact.name === username) {
      document.getElementById('chat-status').textContent = c.status;
    }
    renderContacts();
  }
}

function showTyping(username) {
  const el = document.getElementById('typing-indicator');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `<div class="flex items-center gap-2">
    <span class="text-xs text-blue-400">${username} is typing</span>
    <div class="flex gap-0.5">
      <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay:0ms"></span>
      <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay:150ms"></span>
      <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay:300ms"></span>
    </div>
  </div>`;
  document.getElementById('chat-message').scrollTop = document.getElementById('chat-message').scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

function sendTyping() {
  if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;
  if (!isTyping) { isTyping = true; chatSocket.send(JSON.stringify({ type: 'typing' })); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ type: 'stop_typing' }));
  }, 1500);
}

function sendReadReceipt() {
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ type: 'read_receipt' }));
}

function filterContacts(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#contact-list > div').forEach(el => {
    const name = el.dataset.name?.toLowerCase() || '';
    el.classList.toggle('hidden', !name.includes(q));
  });
}

function renderContacts() {
  const list = document.getElementById("contact-list");
  list.innerHTML = contacts
    .map(
      (c, i) => `
        <div
          data-name="${c.name}"
          onclick="selectContact(${c.id})"
          class="flex items-center bg-[hsl(234,15%,13%)] p-3 rounded-[14px] space-x-2 shadow-2xl cursor-pointer transition-all duration-200 hover:bg-[hsl(234,15%,17%)] ${activeContact && activeContact.id === c.id ? 'ring-2 ring-blue-500 bg-[hsl(234,15%,17%)]' : ''}"
          style="${i < 3 && !chatSocket ? '' : ''}"
        >
          <div class="relative shrink-0">
            <img src="${c.avatar}" alt="${c.name}" class="h-[3.5em] w-auto rounded-lg" onerror="initialsAvatar(this, '${c.name}')" />
            <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[hsl(234,15%,13%)] ${c.status === 'Online' ? 'bg-green-500' : 'bg-gray-500'}"></span>
          </div>
          <div class="flex flex-col flex-1 gap-0.5 min-w-0">
            <span class="text-[15px] font-semibold truncate">${c.name}</span>
            <span class="text-xs text-gray-500 truncate">${c.message?.at(-1)?.text || ""}</span>
          </div>
          <div class="flex flex-col ml-auto gap-1 items-center shrink-0">
            <span class="text-[10px] text-gray-500">${c.message?.at(-1)?.time || ""}</span>
            ${c.unread ? `<span class="text-[10px] bg-amber-600 rounded-full px-1.5 text-white font-medium">${c.unread}</span>` : ""}
          </div>
        </div>`
    )
    .join("");
}

function renderChat() {
  if (!activeContact) return;

  document.getElementById("chat-username").textContent = activeContact.name;
  document.getElementById("chat-status").textContent = activeContact.status;
  const avatar = document.getElementById("chat-avatar");
  avatar.onerror = () => initialsAvatar(avatar, activeContact.name);
  avatar.src = activeContact.avatar;

  const container = document.getElementById("chat-message");
  const messages = activeContact.message;

  if (messages.length === 0) {
    const isGlobal = activeContact.name === "Global Chat";
    container.innerHTML = `<div id="empty-chat" class="flex flex-col items-center justify-center h-full text-gray-500">
      <svg xmlns="http://www.w3.org/2000/svg" height="64px" viewBox="0 -960 960 960" width="64px" fill="currentColor" class="mb-4 opacity-40">
        ${isGlobal ? '<path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm160-320h480v-80H240v80Zm0-160h480v-80H240v80Zm0-160h480v-80H240v80Z"/>' : '<path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z"/>'}
      </svg>
      <p class="text-lg font-medium">${isGlobal ? 'No messages in global chat' : 'No messages yet'}</p>
      <p class="text-sm mt-1">${isGlobal ? 'Be the first to say something!' : 'Send a message to start the conversation'}</p>
    </div>`;
    return;
  }

  container.innerHTML = messages
    .map((m, i) => `
      <div class="flex ${m.from === "me" ? "justify-end" : "justify-start"} mb-1 msg-animate">
        <div class="max-w-[70%] px-4 py-2.5 rounded-xl text-sm leading-relaxed group relative break-words transition-all duration-150 hover:brightness-110 ${m.from === "me" ? "bg-gradient-to-br from-blue-500 to-blue-700 text-white bubble-me" : "bg-[hsl(234,15%,16%)] bubble-them"}">
          ${isImage(m.text) ? `<img src="${m.text}" class="max-w-full max-h-64 rounded-lg block cursor-pointer lightbox-img" />` : m.text.replace(/\n/g, '<br>')}
          <div class="flex items-center gap-1 mt-1.5 ${m.from === "me" ? "justify-end" : "justify-start"}">
            ${m.time ? `<span class="text-[10px] ${m.from === "me" ? "text-blue-200" : "text-gray-400"}">${m.time}</span>` : ""}
            ${m.from === "me" && m.seen ? `<span class="text-[10px] text-blue-300">Seen</span>` : ""}
          </div>
          ${m.id ? `<button onclick="deleteSingleMessage(${m.id})" class="hidden group-hover:flex absolute -top-2 -right-2 items-center justify-center w-5 h-5 bg-gray-700 hover:bg-red-500 rounded-full transition-colors" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" height="12px" viewBox="0 -960 960 960" width="12px" fill="#e3e3e3"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg></button>` : ''}
        </div>
      </div>`)
    .join("");

  if (autoScroll) {
    container.scrollTop = container.scrollHeight;
  }
}

function selectContact(id) {
  activeContact = contacts.find((c) => c.id === parseInt(id));
  activeContact.unread = 0;
  connectToRoom(activeContact.name);
  renderContacts();
  renderChat();
  sendReadReceipt();
  if (searchOpen) toggleSearch();
}

function sendMessage() {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text) return;

  if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
    console.error("WebSocket not open");
    return;
  }

  chatSocket.send(JSON.stringify({ type: 'message', message: text, username: currentUserName }));
  input.value = "";
  isTyping = false;
  clearTimeout(typingTimer);
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ type: 'stop_typing' }));

  const btn = document.getElementById("send-btn");
  btn.classList.add("pulse");
  setTimeout(() => btn.classList.remove("pulse"), 200);
}

let searchOpen = false;
let autoScroll = true;

function scrollToBottom() {
  const c = document.getElementById('chat-message');
  c.scrollTop = c.scrollHeight;
  autoScroll = true;
  document.getElementById('scroll-bottom-btn').classList.add('hidden');
}

function toggleSearch() {
  searchOpen = !searchOpen;
  const bar = document.getElementById('msg-search-bar');
  const input = document.getElementById('msg-search-input');
  bar.classList.toggle('hidden', !searchOpen);
  if (searchOpen) { input.focus(); input.value = ''; searchMessages(''); }
}

function searchMessages(q) {
  const els = document.querySelectorAll('#chat-message > div');
  const count = document.getElementById('search-count');
  if (!q) {
    els.forEach(el => el.classList.remove('hidden'));
    count.textContent = '';
    return;
  }
  const lower = q.toLowerCase();
  let matches = 0;
  els.forEach(el => {
    const text = el.textContent.toLowerCase();
    const match = text.includes(lower);
    el.classList.toggle('hidden', !match);
    if (match) matches++;
  });
  count.textContent = matches ? `${matches} match${matches > 1 ? 'es' : ''}` : 'No results';
}

function showConfirm(msg, onConfirm) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal').classList.remove('hidden');
  document.getElementById('confirm-ok').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    onConfirm();
  };
  document.getElementById('confirm-cancel').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
  };
}

function deleteSingleMessage(msgId) {
  showConfirm('Delete this message?', () => {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
      chatSocket.send(JSON.stringify({ type: 'delete_message', msg_id: msgId }));
    }
    fetch('/delete-message/' + msgId + '/', { method: 'POST', headers: { 'X-CSRFToken': csrfToken } })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          activeContact.message = activeContact.message.filter(m => m.id !== msgId);
          renderChat();
          renderContacts();
        }
      });
  });
}

function deleteChat() {
  if (!activeContact || activeContact.id === -1) return;
  showConfirm('Delete all messages with ' + activeContact.name + '? This cannot be undone.', () => {
    fetch('/delete-chat/' + activeContact.id + '/', { method: 'POST', headers: { 'X-CSRFToken': csrfToken } })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          activeContact.message = [];
          renderChat();
          renderContacts();
        }
      });
  });
}

function handlePaste(e) {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = function(ev) {
        const dataUrl = ev.target.result;
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
          chatSocket.send(JSON.stringify({ type: 'message', message: dataUrl, username: currentUserName }));
        }
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}

const EMOJIS = [
  '😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😗','😋','😛','😜','🤪','😝','🤑',
  '🤗','🤭','🤫','🤔','🤐','😐','😑','😶','😏','😒','🙄','😬','😮','😯','😲','😳','🥺','😢','😭','😤','😡','😠',
  '🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿',
  '😾','👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','👍','👎',
  '👊','✊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💕','💞','💓','💗','💖','💘','💝',
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦',
  '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍',
  '⚽️','🏀','🏈','⚾️','🎾','🏐','🎱','🏓','🏸','🎣','🎽','🎿',
  '🚗','🚕','🚙','🚌','🚎','🚓','🚑','🚲','✈️','🚁','🚀','🚢',
  '🌞','🌝','🌛','🌜','🌚','⭐️','🌟','✨','⚡️','🔥','🌈','☀️','🌤','⛅️','🌧','❄️','🌊',
  '🎄','🎉','🎊','🎈','🎁','🎀','🎃','🎗','🏆','🥇','🥈','🥉',
  '💻','📱','⌨️','🖥','🖨','📷','📸','📹','🎥','📞','📺','📻','🔋','🔌','💡','🔦',
  '🔧','🔨','🔪','🗡','⚔️','🛡','🔮','💊','💉','🔬','🔭',
  '🏠','🏡','🏢','🏭','🏥','🏦','🏨','🏪','🏫','🏯','🏰','🗼','🗽','⛪️','🕌',
];

const EMOJI_PICKER_VISIBLE = { current: false };

function initEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  picker.innerHTML = EMOJIS.map(e => `<span class="inline-block text-2xl cursor-pointer hover:scale-125 transition-transform p-1">${e}</span>`).join('');

  picker.addEventListener('click', (e) => {
    const emoji = e.target.textContent;
    if (emoji && emoji.length <= 2) {
      const input = document.getElementById('msg-input');
      const start = input.selectionStart;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(input.selectionEnd);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
    }
  });

  document.getElementById('emoji-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    EMOJI_PICKER_VISIBLE.current = !EMOJI_PICKER_VISIBLE.current;
    picker.classList.toggle('hidden', !EMOJI_PICKER_VISIBLE.current);
  });

  document.addEventListener('click', (e) => {
    if (EMOJI_PICKER_VISIBLE.current && !e.target.closest('#emoji-btn')) {
      EMOJI_PICKER_VISIBLE.current = false;
      picker.classList.add('hidden');
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("msg-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  document.getElementById("msg-input").addEventListener("input", sendTyping);
  document.getElementById("msg-input").addEventListener("paste", handlePaste);
  document.getElementById("file-input").addEventListener("change", function() {
    const file = this.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Image too large (max 5MB)."); this.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function(ev) {
      const dataUrl = ev.target.result;
      if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ type: 'message', message: dataUrl }));
      }
    };
    reader.readAsDataURL(file);
    this.value = '';
  });

  document.getElementById("send-btn").addEventListener("click", sendMessage);

  document.getElementById("search-msg-btn").addEventListener("click", toggleSearch);

  initEmojiPicker();

  if (contacts.length > 0) {
    const targetContact = contacts.find(c => c.id === selectedUserId) || contacts[0];
    activeContact = targetContact;
    connectToRoom(activeContact.name);
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  document.getElementById('chat-message').addEventListener('click', function(e) {
    if (e.target.classList.contains('lightbox-img')) {
      openLightbox(e.target.src);
    }
  });

  const chatMsg = document.getElementById('chat-message');
  chatMsg.addEventListener('scroll', () => {
    const atBottom = chatMsg.scrollHeight - chatMsg.scrollTop - chatMsg.clientHeight < 60;
    autoScroll = atBottom;
    document.getElementById('scroll-bottom-btn').classList.toggle('hidden', atBottom);
  });

  renderContacts();
  renderChat();
});
