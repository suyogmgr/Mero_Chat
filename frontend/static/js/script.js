function isImage(url) {
  return url && (url.startsWith('data:image/') || url.match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i));
}

function getRoomName(user1, user2) {
  return [user1, user2].sort().join('_');
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
          from: data.username === currentUserName ? "me" : "them",
          text: data.message,
          time: formatTime(data.timestamp),
        });
        renderChat();
        renderContacts();
        if (data.username !== currentUserName && !document.hasFocus()) playNotification();
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
            <span class="text-sm font-medium truncate">${c.name}</span>
            <span class="text-[11px] text-gray-400 truncate">${c.message?.at(-1)?.text || ""}</span>
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
  avatar.src = activeContact.avatar;
  avatar.onerror = () => initialsAvatar(avatar, activeContact.name);

  const container = document.getElementById("chat-message");
  const messages = activeContact.message;

  if (messages.length === 0) {
    container.innerHTML = `<div id="empty-chat" class="flex flex-col items-center justify-center h-full text-gray-500">
      <svg xmlns="http://www.w3.org/2000/svg" height="64px" viewBox="0 -960 960 960" width="64px" fill="currentColor" class="mb-4 opacity-40">
        <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z"/>
      </svg>
      <p class="text-lg font-medium">No messages yet</p>
      <p class="text-sm mt-1">Send a message to start the conversation</p>
    </div>`;
    return;
  }

  container.innerHTML = messages
    .map((m, i) => `
      <div class="flex ${m.from === "me" ? "justify-end" : "justify-start"} mb-2 msg-animate" style="animation-delay:${i === messages.length - 1 ? '0' : '0'}ms">
        <div class="max-w-[70%] px-4 py-2.5 rounded-xl text-sm leading-relaxed ${m.from === "me" ? "bg-blue-600 text-white bubble-me" : "bg-[hsl(234,15%,16%)] bubble-them"}">
          ${isImage(m.text) ? `<img src="${m.text}" class="max-w-full max-h-64 rounded-lg" />` : m.text.replace(/\n/g, '<br>')}
          ${m.time ? `<div class="text-[10px] mt-1.5 ${m.from === "me" ? "text-blue-200" : "text-gray-400"}">${m.time}</div>` : ""}
        </div>
      </div>`)
    .join("");

  container.scrollTop = container.scrollHeight;
}

function selectContact(id) {
  activeContact = contacts.find((c) => c.id === parseInt(id));
  activeContact.unread = 0;
  connectToRoom(activeContact.name);
  renderContacts();
  renderChat();
  sendReadReceipt();
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

function deleteChat() {
  if (!activeContact || !confirm('Delete all messages with ' + activeContact.name + '?')) return;
  fetch('/delete-chat/' + activeContact.id + '/', { method: 'POST', headers: { 'X-CSRFToken': csrfToken } })
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        activeContact.message = [];
        renderChat();
        renderContacts();
      }
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

  document.getElementById("send-btn").addEventListener("click", sendMessage);

  initEmojiPicker();

  if (contacts.length > 0) {
    const targetContact = contacts.find(c => c.id === selectedUserId) || contacts[0];
    activeContact = targetContact;
    connectToRoom(activeContact.name);
  }

  renderContacts();
  renderChat();
});
