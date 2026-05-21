
(function () {
  'use strict';

  // ── Config injected via script tag data attributes ──────────────────────────
  const script = document.currentScript;
  const CLIENT_ID = script?.getAttribute('data-client-id') || '';
  const API_URL = script?.getAttribute('data-api-url') || 'http://localhost:3001';
  const PRIMARY_COLOR = script?.getAttribute('data-color') || '#1D9E75';
  const TITLE = script?.getAttribute('data-title') || 'Support';
  const PLACEHOLDER = script?.getAttribute('data-placeholder') || 'Ask us anything...';
  const WELCOME_MSG = script?.getAttribute('data-welcome') || 'Hi! How can I help you today?';

  // ── Session ID (persists for this browser tab) ───────────────────────────────
  const SESSION_ID = 'sess_' + Math.random().toString(36).slice(2);

  // ── State ─────────────────────────────────────────────────────────────────────
  let isOpen = false;
  let isTyping = false;
  let messages = [{ role: 'assistant', content: WELCOME_MSG }];

  // ── Inject styles ─────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ap-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; }
    #ap-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 52px; height: 52px; border-radius: 50%;
      background: ${PRIMARY_COLOR}; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s ease;
    }
    #ap-bubble:hover { transform: scale(1.08); }
    #ap-bubble svg { width: 24px; height: 24px; fill: white; }
    #ap-window {
      position: fixed; bottom: 88px; right: 24px; z-index: 99998;
      width: 360px; height: 520px; border-radius: 16px;
      background: #ffffff; border: 0.5px solid #e0e0d8;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; pointer-events: none;
      transform: translateY(12px) scale(0.97);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #ap-window.open { opacity: 1; pointer-events: all; transform: translateY(0) scale(1); }
    #ap-header {
      background: ${PRIMARY_COLOR}; padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    #ap-header-title { color: white; font-size: 15px; font-weight: 500; }
    #ap-header-sub { color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 1px; }
    #ap-close {
      background: none; border: none; cursor: pointer;
      color: white; opacity: 0.8; padding: 4px; line-height: 1;
      font-size: 20px;
    }
    #ap-close:hover { opacity: 1; }
    #ap-messages {
      flex: 1; overflow-y: auto; padding: 16px 12px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    #ap-messages::-webkit-scrollbar { width: 4px; }
    #ap-messages::-webkit-scrollbar-thumb { background: #e0e0d8; border-radius: 2px; }
    .ap-msg {
      max-width: 82%; padding: 9px 13px; border-radius: 14px;
      font-size: 14px; line-height: 1.5; word-break: break-word;
    }
    .ap-msg.user {
      align-self: flex-end; background: ${PRIMARY_COLOR};
      color: white; border-bottom-right-radius: 4px;
    }
    .ap-msg.assistant {
      align-self: flex-start; background: #f1efea;
      color: #1a1a1a; border-bottom-left-radius: 4px;
    }
    .ap-typing {
      align-self: flex-start; background: #f1efea;
      border-radius: 14px; border-bottom-left-radius: 4px;
      padding: 10px 14px; display: flex; gap: 4px; align-items: center;
    }
    .ap-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #aaa; animation: ap-bounce 1.2s infinite;
    }
    .ap-dot:nth-child(2) { animation-delay: 0.2s; }
    .ap-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ap-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }
    #ap-input-row {
      padding: 10px 12px; border-top: 0.5px solid #e0e0d8;
      display: flex; gap: 8px; align-items: flex-end;
    }
    #ap-input {
      flex: 1; border: 0.5px solid #e0e0d8; border-radius: 10px;
      padding: 9px 12px; font-size: 14px; resize: none;
      outline: none; line-height: 1.4; max-height: 100px;
      font-family: inherit; background: #fafaf8; color: #1a1a1a;
    }
    #ap-input:focus { border-color: ${PRIMARY_COLOR}; background: white; }
    #ap-send {
      width: 36px; height: 36px; border-radius: 10px; border: none;
      background: ${PRIMARY_COLOR}; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: opacity 0.15s;
    }
    #ap-send:disabled { opacity: 0.4; cursor: not-allowed; }
    #ap-send svg { width: 16px; height: 16px; fill: white; }
    #ap-footer {
      text-align: center; font-size: 11px; color: #b0ae a8;
      padding: 6px; border-top: 0.5px solid #f0ede6;
    }
    @media (max-width: 420px) {
      #ap-window { width: calc(100vw - 24px); right: 12px; bottom: 80px; }
      #ap-bubble { bottom: 16px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── Build DOM ─────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'ap-widget';
  root.innerHTML = `
    <button id="ap-bubble" aria-label="Open support chat">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    </button>
    <div id="ap-window" role="dialog" aria-label="Support chat">
      <div id="ap-header">
        <div>
          <div id="ap-header-title">${TITLE}</div>
          <div id="ap-header-sub">Typically replies instantly</div>
        </div>
        <button id="ap-close" aria-label="Close chat">×</button>
      </div>
      <div id="ap-messages" aria-live="polite"></div>
      <div id="ap-input-row">
        <textarea id="ap-input" rows="1" placeholder="${PLACEHOLDER}" aria-label="Message"></textarea>
        <button id="ap-send" aria-label="Send message" disabled>
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div id="ap-footer">Powered by AI · <a href="#" style="color:inherit">Privacy</a></div>
    </div>
  `;
  document.body.appendChild(root);

  // ── Element refs ──────────────────────────────────────────────────────────────
  const bubble = document.getElementById('ap-bubble');
  const win = document.getElementById('ap-window');
  const closeBtn = document.getElementById('ap-close');
  const messagesEl = document.getElementById('ap-messages');
  const input = document.getElementById('ap-input');
  const sendBtn = document.getElementById('ap-send');

  // ── Render messages ───────────────────────────────────────────────────────────
  function renderMessages() {
    messagesEl.innerHTML = '';
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'ap-msg ' + m.role;
      div.textContent = m.content;
      messagesEl.appendChild(div);
    });
    if (isTyping) {
      const dots = document.createElement('div');
      dots.className = 'ap-typing';
      dots.innerHTML = '<div class="ap-dot"></div><div class="ap-dot"></div><div class="ap-dot"></div>';
      messagesEl.appendChild(dots);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Toggle open/close ─────────────────────────────────────────────────────────
  function toggleWindow() {
    isOpen = !isOpen;
    win.classList.toggle('open', isOpen);
    if (isOpen) {
      renderMessages();
      setTimeout(() => input.focus(), 200);
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isTyping) return;

    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    isTyping = true;
    renderMessages();

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, from: SESSION_ID, body: text })
      });

      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      messages.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      messages.push({ role: 'assistant', content: 'Sorry, something went wrong. Please try again.' });
    } finally {
      isTyping = false;
      sendBtn.disabled = false;
      renderMessages();
      input.focus();
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────────
  bubble.addEventListener('click', toggleWindow);
  closeBtn.addEventListener('click', toggleWindow);

  input.addEventListener('input', function () {
    sendBtn.disabled = !this.value.trim();
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // Close on outside click
  document.addEventListener('click', function (e) {
    if (isOpen && !root.contains(e.target)) toggleWindow();
  });

  renderMessages();
})();
