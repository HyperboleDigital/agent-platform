(function () {
  'use strict';

  const script = document.currentScript;
  const CLIENT_ID = script?.getAttribute('data-client-id') || '';
  const API_URL = script?.getAttribute('data-api-url') || 'http://localhost:3001';
  const TITLE = script?.getAttribute('data-title') || 'Chat with us';
  const WELCOME = script?.getAttribute('data-welcome') || "Hey 👋 I'm here to help. What can I do for you?";

  const SESSION_ID = 'sess_' + Math.random().toString(36).slice(2);

  let isOpen = false;
  let isTyping = false;
  let view = 'chat';
  let messages = [{ role: 'assistant', content: WELCOME, ts: Date.now() }];

  const style = document.createElement('style');
  style.textContent = `
    #ap-widget {
      --p: #6C5CE7;
      --p-dark: #5A4AE0;
      --p-light: #F4F1FF;
      --p-bubble: #EEEBFF;
      --text: #1A1B26;
      --muted: #6B7280;
      --faded: #A5A3B8;
      --border: #E8E6F0;
      --success: #22C55E;
      --white: #ffffff;
      --bg-input: #F7F6FB;
    }

    #ap-widget, #ap-widget * {
      box-sizing: border-box; margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    /* Bubble */
    #ap-bubble {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      width: 60px; height: 60px; border-radius: 50%;
      background: var(--p);
      border: none; cursor: pointer;
      box-shadow: 0 10px 32px rgba(108,92,231,0.4), 0 4px 12px rgba(0,0,0,0.08);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
    }
    #ap-bubble:hover { transform: translateY(-3px) scale(1.05); }
    #ap-bubble:active { transform: scale(0.92); }
    #ap-bubble svg { width: 28px; height: 28px; fill: white; position: absolute; transition: transform 0.3s ease, opacity 0.25s ease; }
    #ap-bubble .icon-close { opacity: 0; transform: rotate(-45deg); }
    #ap-bubble.open .icon-chat { opacity: 0; transform: rotate(45deg); }
    #ap-bubble.open .icon-close { opacity: 1; transform: rotate(0deg); }

    /* Window */
    #ap-window {
      position: fixed; bottom: 96px; right: 20px; z-index: 99998;
      width: 380px; height: 620px; max-height: calc(100vh - 130px);
      border-radius: 24px; background: var(--white);
      box-shadow: 0 24px 64px rgba(108,92,231,0.18), 0 4px 16px rgba(0,0,0,0.06);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; pointer-events: none;
      transform: translateY(20px) scale(0.94);
      transform-origin: bottom right;
      transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
    }
    #ap-window.open { opacity: 1; pointer-events: all; transform: translateY(0) scale(1); }

    /* Header */
    #ap-header {
      background: var(--p);
      padding: 24px;
      color: white; flex-shrink: 0;
    }
    .ap-h-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .ap-h-text { min-width: 0; flex: 1; }
    .ap-h-actions { display: flex; gap: 8px; flex-shrink: 0; }
    .ap-h-btn {
      width: 36px; height: 36px; border-radius: 12px; border: none;
      background: rgba(255,255,255,0.15); color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, transform 0.15s;
    }
    .ap-h-btn:hover { background: rgba(255,255,255,0.25); }
    .ap-h-btn:active { transform: scale(0.9); }
    .ap-h-btn svg { width: 18px; height: 18px; fill: white; }
    #ap-title { font-size: 20px; font-weight: 700; letter-spacing: -0.4px; line-height: 1.2; }
    #ap-status { font-size: 13px; opacity: 0.85; display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .ap-dot-online { width: 7px; height: 7px; border-radius: 50%; background: #4ADE80; box-shadow: 0 0 8px #4ADE80; animation: ap-pulse 2s infinite; }
    @keyframes ap-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

    /* Chat view */
    #ap-chat-view { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--white); }

    #ap-messages {
      flex: 1; overflow-y: auto;
      padding: 24px 20px 12px;
      display: flex; flex-direction: column; gap: 4px;
      scroll-behavior: smooth;
    }
    #ap-messages::-webkit-scrollbar { width: 0; }

    .ap-time-divider {
      text-align: center; font-size: 11px; color: var(--faded);
      font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase;
      margin: 16px 0 12px;
    }
    .ap-time-divider:first-child { margin-top: 0; }

    .ap-msg-group { display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px; }
    .ap-msg-group.user { align-items: flex-end; }
    .ap-msg-group.assistant { align-items: flex-start; }
    .ap-msg-group:last-child { margin-bottom: 0; }

    .ap-msg {
      max-width: 78%; padding: 11px 16px;
      font-size: 15px; line-height: 1.45;
      word-wrap: break-word;
      animation: ap-msg-in 0.35s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes ap-msg-in {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ap-msg.user { background: var(--p); color: white; border-radius: 20px 20px 6px 20px; }
    .ap-msg.user.middle, .ap-msg.user.first { border-radius: 20px 20px 6px 20px; }
    .ap-msg.user.last { border-radius: 20px 6px 20px 20px; }
    .ap-msg.user.middle { border-radius: 20px 6px 6px 20px; }

    .ap-msg.assistant { background: var(--p-bubble); color: var(--text); border-radius: 20px 20px 20px 6px; }
    .ap-msg.assistant.middle { border-radius: 6px 20px 20px 6px; }
    .ap-msg.assistant.last { border-radius: 6px 20px 20px 20px; }

    .ap-typing {
      background: var(--p-bubble); border-radius: 20px 20px 20px 6px;
      padding: 14px 18px; display: inline-flex; gap: 5px; align-items: center;
      animation: ap-msg-in 0.25s ease;
    }
    .ap-tdot { width: 7px; height: 7px; border-radius: 50%; background: var(--p); animation: ap-typing 1.2s infinite ease-in-out; }
    .ap-tdot:nth-child(2) { animation-delay: 0.15s; }
    .ap-tdot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes ap-typing { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }

    #ap-chips { padding: 0 20px 12px; display: flex; flex-wrap: wrap; gap: 8px; }
    .ap-chip {
      font-size: 13px; padding: 8px 14px; border-radius: 999px;
      background: var(--white); border: 1.5px solid var(--p);
      color: var(--p); cursor: pointer; font-weight: 500;
      transition: all 0.2s ease;
    }
    .ap-chip:hover { background: var(--p); color: white; }
    .ap-chip:active { transform: scale(0.96); }

    #ap-input-wrap { padding: 12px 20px 20px; flex-shrink: 0; }
    #ap-input-row {
      display: flex; align-items: center; gap: 8px;
      background: var(--bg-input);
      border: 2px solid transparent;
      border-radius: 999px;
      padding: 4px 4px 4px 18px;
      transition: background 0.2s, border-color 0.2s;
    }
    #ap-input-row.focused { background: var(--white); border-color: var(--p); }
    #ap-input {
      flex: 1; border: none; background: transparent;
      padding: 10px 0; font-size: 15px; resize: none; outline: none;
      line-height: 1.4; max-height: 100px; font-family: inherit; color: var(--text);
    }
    #ap-input::placeholder { color: var(--faded); }
    #ap-send {
      width: 38px; height: 38px; border-radius: 50%; border: none;
      background: var(--p); cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: opacity 0.2s, transform 0.2s, background 0.2s;
    }
    #ap-send:hover:not(:disabled) { transform: scale(1.08); background: var(--p-dark); }
    #ap-send:active:not(:disabled) { transform: scale(0.92); }
    #ap-send:disabled { opacity: 0.35; cursor: not-allowed; }
    #ap-send svg { width: 16px; height: 16px; fill: white; transform: translateX(-1px); }

    /* Contact view — Intercom-style minimal form */
    #ap-contact {
      flex: 1; display: flex; flex-direction: column;
      padding: 20px 24px 24px;
      background: var(--white); overflow-y: auto;
    }
    .cf-back {
      align-self: flex-start;
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 13px; font-weight: 600; color: var(--p);
      background: var(--p-light); border: none; cursor: pointer;
      padding: 8px 14px 8px 10px; border-radius: 999px;
      transition: background 0.2s;
    }
    .cf-back:hover { background: var(--p-bubble); }
    .cf-back svg { width: 16px; height: 16px; fill: currentColor; }

    .cf-header { margin-top: 24px; margin-bottom: 28px; }
    .cf-title { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.4px; line-height: 1.25; }
    .cf-sub { font-size: 14px; color: var(--muted); margin-top: 6px; line-height: 1.5; }

    .cf-field { margin-bottom: 20px; }
    .cf-field:last-of-type { margin-bottom: 24px; }
    .cf-label {
      display: block; font-size: 13px; font-weight: 600;
      color: var(--text); margin-bottom: 8px;
    }
    .cf-field input, .cf-field textarea {
      width: 100%; padding: 12px 14px; border-radius: 12px;
      border: 1.5px solid var(--border); font-size: 15px; font-family: inherit;
      background: var(--white); color: var(--text); outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      min-height: 44px;
    }
    .cf-field input::placeholder, .cf-field textarea::placeholder { color: var(--faded); }
    .cf-field input:focus, .cf-field textarea:focus {
      border-color: var(--p);
      box-shadow: 0 0 0 3px rgba(108,92,231,0.15);
    }
    .cf-field textarea { resize: none; min-height: 100px; line-height: 1.5; padding-top: 12px; }

    .cf-submit {
      width: 100%; padding: 14px; border-radius: 12px; border: none;
      background: var(--p); color: white;
      font-size: 15px; font-weight: 600; cursor: pointer;
      transition: background 0.2s, transform 0.15s;
      min-height: 48px;
    }
    .cf-submit:hover:not(:disabled) { background: var(--p-dark); }
    .cf-submit:active { transform: scale(0.98); }
    .cf-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Success view */
    #ap-success {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
      padding: 40px 24px; background: var(--white);
      animation: ap-msg-in 0.4s ease;
    }
    .ap-check {
      width: 72px; height: 72px; border-radius: 50%;
      background: var(--success);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 20px;
      animation: ap-pop 0.5s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes ap-pop { from { transform: scale(0); } to { transform: scale(1); } }
    .ap-check svg { width: 36px; height: 36px; fill: white; }
    #ap-success h3 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.4px; margin-bottom: 8px; }
    #ap-success p { font-size: 14px; color: var(--muted); line-height: 1.5; max-width: 280px; margin-bottom: 24px; }
    #ap-success button {
      padding: 12px 24px; border-radius: 12px; border: none;
      background: var(--p); color: white;
      font-size: 14px; font-weight: 600; cursor: pointer;
      transition: background 0.2s, transform 0.15s;
    }
    #ap-success button:hover { background: var(--p-dark); }
    #ap-success button:active { transform: scale(0.96); }

    #ap-footer {
      text-align: center; font-size: 11px; color: var(--faded);
      padding: 6px 20px 12px;
      background: var(--white); flex-shrink: 0;
    }
    #ap-footer a { color: inherit; text-decoration: none; font-weight: 500; }
    #ap-footer a:hover { color: var(--p); }

    @media (max-width: 420px) {
      #ap-window { width: calc(100vw - 16px); right: 8px; bottom: 88px; height: calc(100vh - 110px); }
      #ap-bubble { bottom: 14px; right: 14px; }
    }
  `;
  document.head.appendChild(style);

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
          <div class="ap-h-text">
            <div id="ap-title">${TITLE}</div>
            <div id="ap-status"><span class="ap-dot-online"></span> Online · replies in seconds</div>
          </div>
          <div class="ap-h-actions">
            <button class="ap-h-btn" id="ap-contact-trigger" aria-label="Contact us">
              <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
            </button>
            <button class="ap-h-btn" id="ap-close-btn" aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div id="ap-chat-view">
        <div id="ap-messages"></div>
        <div id="ap-chips"></div>
        <div id="ap-input-wrap">
          <div id="ap-input-row">
            <textarea id="ap-input" rows="1" placeholder="Type a message..."></textarea>
            <button id="ap-send" disabled aria-label="Send">
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div id="ap-contact" style="display:none">
        <button class="cf-back" id="cf-back-btn">
          <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          Back
        </button>
        <div class="cf-header">
          <div class="cf-title">Get in touch</div>
          <div class="cf-sub">Leave a message and we'll get back to you shortly.</div>
        </div>
        <div class="cf-field">
          <label class="cf-label" for="cf-name">Name</label>
          <input id="cf-name" type="text" placeholder="Jane Smith" />
        </div>
        <div class="cf-field">
          <label class="cf-label" for="cf-email">Email</label>
          <input id="cf-email" type="email" placeholder="jane@company.com" />
        </div>
        <div class="cf-field">
          <label class="cf-label" for="cf-message">Message</label>
          <textarea id="cf-message" placeholder="What can we help with?"></textarea>
        </div>
        <button class="cf-submit" id="cf-submit">Send message</button>
      </div>
      <div id="ap-success" style="display:none">
        <div class="ap-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
        <h3>Message sent!</h3>
        <p>Thanks for reaching out. We'll get back to you within a few hours.</p>
        <button id="ap-back-to-chat">Continue chatting</button>
      </div>
      <div id="ap-footer">Powered by <a href="https://hyperboledigital.com" target="_blank">Hyperbole Digital</a></div>
    </div>
  `;
  document.body.appendChild(root);

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

  function renderMessages() {
    messagesEl.innerHTML = '';
    let lastTs = 0, lastRole = null, group = [];

    function flushGroup() {
      if (!group.length) return;
      const wrap = document.createElement('div');
      wrap.className = `ap-msg-group ${group[0].role}`;
      group.forEach((m, i) => {
        const div = document.createElement('div');
        let pos = '';
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
      if (i === 0 || (m.ts - lastTs) > 5 * 60 * 1000) {
        flushGroup();
        const div = document.createElement('div');
        div.className = 'ap-time-divider';
        div.textContent = formatTimeDivider(m.ts);
        messagesEl.appendChild(div);
      }
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
    if (messages.length !== 1 || isTyping) { chipsEl.innerHTML = ''; chipsEl.style.display = 'none'; return; }
    chipsEl.style.display = 'flex';
    chipsEl.innerHTML = `
      <button class="ap-chip" data-msg="What services do you offer?">What do you offer?</button>
      <button class="ap-chip" data-msg="How much does it cost?">Pricing</button>
      <button class="ap-chip" data-msg="Can I book a call?">Book a call</button>
    `;
    chipsEl.querySelectorAll('.ap-chip').forEach(c => {
      c.addEventListener('click', (e) => { e.stopPropagation(); input.value = c.dataset.msg; sendMessage(); });
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
    input.value = ''; input.style.height = 'auto';
    sendBtn.disabled = true; isTyping = true;
    renderMessages();
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, from: SESSION_ID, body: text })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      messages.push({ role: 'assistant', content: data.reply, ts: Date.now() });
      if (data.action === 'show_contact_form') setView('contact');
    } catch {
      messages.push({ role: 'assistant', content: "I'm having trouble connecting. Try the contact form above and we'll reach out personally.", ts: Date.now() });
    } finally {
      isTyping = false; sendBtn.disabled = false;
      renderMessages(); input.focus();
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, from: email, body: `[Contact form] Name: ${name || 'Unknown'} | Email: ${email} | Message: ${message}` })
      });
    } catch {}
    setView('success');
    cfSubmit.textContent = 'Send message'; cfSubmit.disabled = false;
  }

  root.addEventListener('click', e => e.stopPropagation());
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

  setView('chat');
  renderMessages();
})();