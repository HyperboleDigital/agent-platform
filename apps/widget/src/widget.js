(function () {
  'use strict';

  const script = document.currentScript;
  const CLIENT_ID = script?.getAttribute('data-client-id') || '';
  const API_URL = script?.getAttribute('data-api-url') || 'http://localhost:3001';
  const TITLE = script?.getAttribute('data-title') || 'Support';
  const WELCOME = script?.getAttribute('data-welcome') || 'Hey there 👋 How can I help?';
  const LOGO = script?.getAttribute('data-logo') || '';

  // Modern 2026 palette — deep indigo/violet gradient with iOS-blue sent bubbles
  const ACCENT = '#5B5BF0';
  const ACCENT_DARK = '#4A48D8';
  const SENT_BLUE = '#0A84FF';
  const SENT_BLUE_END = '#0066D6';

  const SESSION_ID = 'sess_' + Math.random().toString(36).slice(2);

  let isOpen = false;
  let isTyping = false;
  let view = 'chat'; // 'chat' | 'contact' | 'success'
  let messages = [{ role: 'assistant', content: WELCOME, ts: Date.now() }];

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ap-widget, #ap-widget * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }

    /* Bubble */
    #ap-bubble {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 18px;
      background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DARK} 100%);
      border: none; cursor: pointer;
      box-shadow: 0 8px 24px ${ACCENT}40, 0 2px 6px rgba(0,0,0,0.08);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease, border-radius 0.3s ease;
    }
    #ap-bubble:hover { transform: translateY(-2px); box-shadow: 0 12px 32px ${ACCENT}55, 0 4px 12px rgba(0,0,0,0.1); }
    #ap-bubble:active { transform: scale(0.94); }
    #ap-bubble.open { border-radius: 50%; }
    #ap-bubble svg { width: 26px; height: 26px; fill: white; position: absolute; transition: transform 0.3s ease, opacity 0.25s ease; }
    #ap-bubble .icon-close { opacity: 0; transform: rotate(-45deg); }
    #ap-bubble.open .icon-chat { opacity: 0; transform: rotate(45deg); }
    #ap-bubble.open .icon-close { opacity: 1; transform: rotate(0deg); }

    /* Window */
    #ap-window {
      position: fixed; bottom: 88px; right: 20px; z-index: 99998;
      width: 380px; height: 600px; max-height: calc(100vh - 120px);
      border-radius: 24px;
      background: #ffffff;
      box-shadow: 0 24px 64px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.06);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; pointer-events: none;
      transform: translateY(20px) scale(0.94);
      transform-origin: bottom right;
      transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
    }
    #ap-window.open { opacity: 1; pointer-events: all; transform: translateY(0) scale(1); }

    /* Header */
    #ap-header {
      background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DARK} 100%);
      padding: 18px 18px 16px;
      position: relative; flex-shrink: 0;
      color: white;
    }
    #ap-header::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(circle at 80% 0%, rgba(255,255,255,0.12) 0%, transparent 50%);
      pointer-events: none;
    }
    .ap-h-row { display: flex; align-items: center; gap: 12px; position: relative; }
    #ap-avatar {
      width: 40px; height: 40px; border-radius: 12px;
      background: rgba(255,255,255,0.18);
      backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    .ap-h-text { flex: 1; min-width: 0; }
    #ap-title { font-size: 15px; font-weight: 600; letter-spacing: -0.2px; }
    #ap-status { font-size: 12px; opacity: 0.85; display: flex; align-items: center; gap: 5px; margin-top: 2px; }
    .ap-dot-online { width: 6px; height: 6px; border-radius: 50%; background: #4ADE80; box-shadow: 0 0 8px #4ADE80; animation: ap-pulse 2s infinite; }
    @keyframes ap-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.9); } }
    .ap-h-actions { display: flex; gap: 6px; }
    .ap-h-btn {
      width: 30px; height: 30px; border-radius: 10px; border: none;
      background: rgba(255,255,255,0.15); color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, transform 0.15s;
    }
    .ap-h-btn:hover { background: rgba(255,255,255,0.25); }
    .ap-h-btn:active { transform: scale(0.9); }
    .ap-h-btn svg { width: 16px; height: 16px; fill: white; }

    /* Messages */
    #ap-messages {
      flex: 1; overflow-y: auto; padding: 14px 14px 4px;
      display: flex; flex-direction: column; gap: 2px;
      scroll-behavior: smooth;
      background: #fafafa;
    }
    #ap-messages::-webkit-scrollbar { width: 0; }

    .ap-time-divider {
      text-align: center; font-size: 11px; color: #8E8E93;
      font-weight: 500; margin: 14px 0 8px;
    }

    .ap-msg-group { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
    .ap-msg-group.user { align-items: flex-end; }
    .ap-msg-group.assistant { align-items: flex-start; }

    .ap-msg {
      max-width: 78%; padding: 9px 14px; font-size: 15px; line-height: 1.35;
      word-wrap: break-word; animation: ap-msg-in 0.3s cubic-bezier(0.34,1.56,0.64,1);
      letter-spacing: -0.1px;
    }
    @keyframes ap-msg-in {
      from { opacity: 0; transform: translateY(6px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ap-msg.user {
      background: linear-gradient(135deg, ${SENT_BLUE} 0%, ${SENT_BLUE_END} 100%);
      color: white;
      border-radius: 20px 20px 6px 20px;
    }
    .ap-msg.user.first { border-radius: 20px 20px 6px 20px; }
    .ap-msg.user.middle { border-radius: 20px 6px 6px 20px; }
    .ap-msg.user.last { border-radius: 20px 6px 20px 20px; }
    .ap-msg.user.single { border-radius: 20px 20px 6px 20px; }

    .ap-msg.assistant {
      background: #E9E9EB;
      color: #1a1a1a;
      border-radius: 20px 20px 20px 6px;
    }
    .ap-msg.assistant.first { border-radius: 20px 20px 20px 6px; }
    .ap-msg.assistant.middle { border-radius: 6px 20px 20px 6px; }
    .ap-msg.assistant.last { border-radius: 6px 20px 20px 20px; }
    .ap-msg.assistant.single { border-radius: 20px 20px 20px 6px; }

    /* Typing */
    .ap-typing {
      background: #E9E9EB; border-radius: 20px 20px 20px 6px;
      padding: 11px 16px; display: inline-flex; gap: 4px; align-items: center;
      animation: ap-msg-in 0.25s ease; margin-top: 2px;
    }
    .ap-tdot { width: 7px; height: 7px; border-radius: 50%; background: #8E8E93; animation: ap-typing 1.2s infinite ease-in-out; }
    .ap-tdot:nth-child(2) { animation-delay: 0.15s; }
    .ap-tdot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes ap-typing {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* Quick action chips */
    #ap-chips { padding: 4px 14px 12px; display: flex; flex-wrap: wrap; gap: 6px; background: #fafafa; }
    .ap-chip {
      font-size: 13px; padding: 7px 14px; border-radius: 16px;
      background: white; border: 1px solid #E5E5EA;
      color: ${ACCENT}; cursor: pointer; font-weight: 500;
      transition: all 0.2s ease;
    }
    .ap-chip:hover { background: ${ACCENT}; color: white; border-color: ${ACCENT}; transform: translateY(-1px); }
    .ap-chip:active { transform: scale(0.96); }

    /* Input */
    #ap-input-wrap {
      padding: 10px 14px 14px; background: white;
      border-top: 1px solid #F2F2F7; flex-shrink: 0;
    }
    #ap-input-row {
      display: flex; gap: 8px; align-items: flex-end;
      background: #F2F2F7; border-radius: 20px; padding: 4px 4px 4px 14px;
      transition: background 0.2s, box-shadow 0.2s;
    }
    #ap-input-row.focused { background: white; box-shadow: 0 0 0 2px ${ACCENT}; }
    #ap-input {
      flex: 1; border: none; background: transparent;
      padding: 8px 0; font-size: 15px; resize: none; outline: none;
      line-height: 1.4; max-height: 100px; font-family: inherit; color: #1a1a1a;
    }
    #ap-input::placeholder { color: #8E8E93; }
    #ap-send {
      width: 32px; height: 32px; border-radius: 50%; border: none;
      background: linear-gradient(135deg, ${SENT_BLUE} 0%, ${SENT_BLUE_END} 100%);
      cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: opacity 0.2s, transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
    }
    #ap-send:hover:not(:disabled) { transform: scale(1.08); }
    #ap-send:active:not(:disabled) { transform: scale(0.92); }
    #ap-send:disabled { opacity: 0.3; cursor: not-allowed; }
    #ap-send svg { width: 16px; height: 16px; fill: white; transform: translateX(-1px); }

    /* Contact view */
    #ap-contact { flex: 1; display: flex; flex-direction: column; padding: 24px 20px; background: #fafafa; overflow-y: auto; }
    #ap-contact .cf-back {
      display: inline-flex; align-items: center; gap: 4px; font-size: 14px; color: ${ACCENT};
      background: none; border: none; cursor: pointer; padding: 0; margin-bottom: 16px; font-weight: 500;
      width: fit-content;
    }
    #ap-contact .cf-back:hover { opacity: 0.7; }
    #ap-contact .cf-title { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; margin-bottom: 4px; }
    #ap-contact .cf-sub { font-size: 14px; color: #6e6e73; margin-bottom: 20px; line-height: 1.4; }
    #ap-contact .cf-label { font-size: 12px; font-weight: 600; color: #6e6e73; text-transform: uppercase; letter-spacing: 0.5px; margin: 14px 0 6px; }
    #ap-contact input, #ap-contact textarea {
      width: 100%; padding: 12px 14px; border-radius: 12px;
      border: 1.5px solid #E5E5EA; font-size: 15px; font-family: inherit;
      background: white; color: #1a1a1a; outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    #ap-contact input:focus, #ap-contact textarea:focus { border-color: ${ACCENT}; box-shadow: 0 0 0 3px ${ACCENT}20; }
    #ap-contact textarea { resize: none; min-height: 90px; }
    #ap-contact .cf-submit {
      margin-top: 20px;
      width: 100%; padding: 14px; border-radius: 14px; border: none;
      background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DARK} 100%);
      color: white; font-size: 15px; font-weight: 600; cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
    }
    #ap-contact .cf-submit:hover { opacity: 0.9; }
    #ap-contact .cf-submit:active { transform: scale(0.98); }
    #ap-contact .cf-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Success */
    #ap-success {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 40px 24px; text-align: center; background: #fafafa;
      animation: ap-msg-in 0.4s ease;
    }
    .ap-check {
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, #4ADE80 0%, #22C55E 100%);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 18px;
      animation: ap-pop 0.5s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes ap-pop { from { transform: scale(0); } to { transform: scale(1); } }
    .ap-check svg { width: 32px; height: 32px; fill: white; }
    #ap-success h3 { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; margin-bottom: 8px; }
    #ap-success p { font-size: 15px; color: #6e6e73; line-height: 1.4; max-width: 260px; margin-bottom: 24px; }
    #ap-success button {
      padding: 12px 24px; border-radius: 12px; border: 1.5px solid ${ACCENT}; background: white;
      color: ${ACCENT}; font-size: 14px; font-weight: 600; cursor: pointer;
      transition: all 0.2s;
    }
    #ap-success button:hover { background: ${ACCENT}; color: white; }

    /* Footer */
    #ap-footer { text-align: center; font-size: 11px; color: #C7C7CC; padding: 6px 14px 10px; background: white; }
    #ap-footer a { color: inherit; text-decoration: none; font-weight: 500; }
    #ap-footer a:hover { color: ${ACCENT}; }

    @media (max-width: 420px) {
      #ap-window { width: calc(100vw - 16px); right: 8px; bottom: 80px; height: calc(100vh - 100px); }
      #ap-bubble { bottom: 12px; right: 12px; }
    }
  `;
  document.head.appendChild(style);

  // ── Build DOM ─────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'ap-widget';
  root.innerHTML = `
    <button id="ap-bubble" aria-label="Open chat">
      <svg class="icon-chat" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.04 2 11c0 2.47 1.13 4.71 2.95 6.34L4 22l4.91-1.55c.96.36 2 .55 3.09.55 5.52 0 10-4.04 10-9s-4.48-9-10-9z"/></svg>
      <svg class="icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>

    <div id="ap-window" role="dialog">
      <div id="ap-header">
        <div class="ap-h-row">
          <div id="ap-avatar">${LOGO ? `<img src="${LOGO}" style="width:100%;height:100%;border-radius:12px;object-fit:cover">` : '✨'}</div>
          <div class="ap-h-text">
            <div id="ap-title">${TITLE}</div>
            <div id="ap-status"><span class="ap-dot-online"></span> Online · replies in seconds</div>
          </div>
          <div class="ap-h-actions">
            <button class="ap-h-btn" id="ap-contact-trigger" aria-label="Contact us" title="Contact us">
              <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
            </button>
            <button class="ap-h-btn" id="ap-close-btn" aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div id="ap-chat-view" style="flex:1; display:flex; flex-direction:column; min-height:0;">
        <div id="ap-messages"></div>
        <div id="ap-chips"></div>
        <div id="ap-input-wrap">
          <div id="ap-input-row">
            <textarea id="ap-input" rows="1" placeholder="Message"></textarea>
            <button id="ap-send" disabled aria-label="Send">
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div id="ap-contact" style="display:none">
        <button class="cf-back" id="cf-back-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          Back to chat
        </button>
        <div class="cf-title">Get in touch</div>
        <div class="cf-sub">Leave us a message and we'll get back to you within a few hours.</div>
        <div class="cf-label">Name</div>
        <input id="cf-name" type="text" placeholder="Jane Smith" />
        <div class="cf-label">Email</div>
        <input id="cf-email" type="email" placeholder="jane@company.com" />
        <div class="cf-label">Message</div>
        <textarea id="cf-message" placeholder="What can we help you with?"></textarea>
        <button class="cf-submit" id="cf-submit">Send message</button>
      </div>

      <div id="ap-success" style="display:none">
        <div class="ap-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
        <h3>Message sent!</h3>
        <p>Thanks for reaching out. We'll get back to you shortly.</p>
        <button id="ap-back-to-chat">Continue chatting</button>
      </div>

      <div id="ap-footer">Powered by <a href="https://hyperboledigital.com" target="_blank">Hyperbole Digital</a></div>
    </div>
  `;
  document.body.appendChild(root);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const bubble = document.getElementById('ap-bubble');
  const win = document.getElementById('ap-window');
  const closeBtn = document.getElementById('ap-close-btn');
  const contactTrigger = document.getElementById('ap-contact-trigger');
  const messagesEl = document.getElementById('ap-messages');
  const chipsEl = document.getElementById('ap-chips');
  const input = document.getElementById('ap-input');
  const inputRow = document.getElementById('ap-input-row');
  const sendBtn = document.getElementById('ap-send');
  const chatView = document.getElementById('ap-chat-view');
  const contactView = document.getElementById('ap-contact');
  const successView = document.getElementById('ap-success');
  const cfSubmit = document.getElementById('cf-submit');
  const cfBack = document.getElementById('cf-back-btn');
  const backToChat = document.getElementById('ap-back-to-chat');

  // ── Helpers ───────────────────────────────────────────────────────────────
  function formatTimeDivider(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const isToday = d.toDateString() === today.toDateString();
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `Today ${time}`;
    if (isYesterday) return `Yesterday ${time}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  }

  // Group consecutive messages from the same sender and add time dividers every 5+ min
  function renderMessages() {
    messagesEl.innerHTML = '';
    let lastTs = 0;
    let lastRole = null;
    let group = [];

    function flushGroup() {
      if (!group.length) return;
      const wrap = document.createElement('div');
      wrap.className = `ap-msg-group ${group[0].role}`;
      group.forEach((m, i) => {
        const div = document.createElement('div');
        let pos = 'single';
        if (group.length > 1) {
          if (i === 0) pos = 'first';
          else if (i === group.length - 1) pos = 'last';
          else pos = 'middle';
        }
        div.className = `ap-msg ${m.role} ${pos}`;
        div.textContent = m.content;
        wrap.appendChild(div);
      });
      messagesEl.appendChild(wrap);
      group = [];
    }

    messages.forEach((m, i) => {
      // Time divider if 5+ min gap or first message
      if (i === 0 || (m.ts - lastTs) > 5 * 60 * 1000) {
        flushGroup();
        const div = document.createElement('div');
        div.className = 'ap-time-divider';
        div.textContent = formatTimeDivider(m.ts);
        messagesEl.appendChild(div);
      }
      // Flush if sender changed
      if (m.role !== lastRole) flushGroup();
      group.push(m);
      lastRole = m.role;
      lastTs = m.ts;
    });
    flushGroup();

    if (isTyping) {
      const wrap = document.createElement('div');
      wrap.className = 'ap-msg-group assistant';
      wrap.innerHTML = '<div class="ap-typing"><div class="ap-tdot"></div><div class="ap-tdot"></div><div class="ap-tdot"></div></div>';
      messagesEl.appendChild(wrap);
    }

    renderChips();
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  }

  function renderChips() {
    // Only show on first turn
    if (messages.length !== 1) { chipsEl.innerHTML = ''; chipsEl.style.display = 'none'; return; }
    chipsEl.style.display = 'flex';
    chipsEl.innerHTML = `
      <button class="ap-chip" data-msg="What services do you offer?">What do you offer?</button>
      <button class="ap-chip" data-msg="How much does it cost?">Pricing</button>
      <button class="ap-chip" data-msg="Can I book a call?">Book a call</button>
    `;
    chipsEl.querySelectorAll('.ap-chip').forEach(c => {
      c.addEventListener('click', () => { input.value = c.dataset.msg; sendMessage(); });
    });
  }

  function setView(v) {
    view = v;
    chatView.style.display = v === 'chat' ? 'flex' : 'none';
    contactView.style.display = v === 'contact' ? 'flex' : 'none';
    successView.style.display = v === 'success' ? 'flex' : 'none';
  }

  function toggleWindow() {
    isOpen = !isOpen;
    win.classList.toggle('open', isOpen);
    bubble.classList.toggle('open', isOpen);
    if (isOpen) {
      renderMessages();
      setTimeout(() => { if (view === 'chat') input.focus(); }, 350);
    }
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isTyping) return;
    messages.push({ role: 'user', content: text, ts: Date.now() });
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
      if (!res.ok) throw new Error();
      const data = await res.json();
      messages.push({ role: 'assistant', content: data.reply, ts: Date.now() });
      if (data.action === 'show_contact_form') setView('contact');
    } catch {
      messages.push({ role: 'assistant', content: "I'm having trouble connecting. Try the contact form above and we'll reach out personally.", ts: Date.now() });
    } finally {
      isTyping = false;
      sendBtn.disabled = false;
      renderMessages();
      input.focus();
    }
  }

  async function submitContact() {
    const name = document.getElementById('cf-name').value.trim();
    const email = document.getElementById('cf-email').value.trim();
    const message = document.getElementById('cf-message').value.trim();
    if (!email || !message) { alert('Please add your email and message.'); return; }
    cfSubmit.textContent = 'Sending...'; cfSubmit.disabled = true;
    try {
      await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID, from: email,
          body: `[Contact form] Name: ${name || 'Unknown'} | Email: ${email} | Message: ${message}`
        })
      });
    } catch {}
    setView('success');
  }

  // ── Events ────────────────────────────────────────────────────────────────
  bubble.addEventListener('click', toggleWindow);
  closeBtn.addEventListener('click', toggleWindow);
  contactTrigger.addEventListener('click', () => setView('contact'));
  cfBack.addEventListener('click', () => setView('chat'));
  backToChat.addEventListener('click', () => {
    setView('chat');
    messages.push({ role: 'assistant', content: "Thanks! Anything else I can help you with?", ts: Date.now() });
    renderMessages();
    setTimeout(() => input.focus(), 100);
  });
  cfSubmit.addEventListener('click', submitContact);

  input.addEventListener('input', function () {
    sendBtn.disabled = !this.value.trim();
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });
  input.addEventListener('focus', () => inputRow.classList.add('focused'));
  input.addEventListener('blur', () => inputRow.classList.remove('focused'));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  sendBtn.addEventListener('click', sendMessage);

  document.addEventListener('click', e => { if (isOpen && !root.contains(e.target)) toggleWindow(); });

  setView('chat');
  renderMessages();
})();