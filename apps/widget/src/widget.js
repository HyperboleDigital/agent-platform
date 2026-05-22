(function () {
  'use strict';

  const script = document.currentScript;
  const CLIENT_ID = script?.getAttribute('data-client-id') || '';
  const API_URL = script?.getAttribute('data-api-url') || 'http://localhost:3001';
  const PRIMARY = script?.getAttribute('data-color') || '#1D9E75';
  const TITLE = script?.getAttribute('data-title') || 'Support';
  const WELCOME = script?.getAttribute('data-welcome') || 'Hi there! 👋 How can I help you today?';
  const LOGO = script?.getAttribute('data-logo') || '';

  const SESSION_ID = 'sess_' + Math.random().toString(36).slice(2);

  let isOpen = false;
  let isTyping = false;
  let showContactForm = false;
  let contactSubmitted = false;
  let messages = [{ role: 'assistant', content: WELCOME, ts: Date.now() }];

  // ── Hex to rgba helper ────────────────────────────────────────────────────
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ap-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; }

    /* Bubble */
    #ap-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 50%;
      background: ${PRIMARY}; border: none; cursor: pointer;
      box-shadow: 0 4px 20px ${hexToRgba(PRIMARY, 0.4)};
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease;
    }
    #ap-bubble:hover { transform: scale(1.1); box-shadow: 0 6px 28px ${hexToRgba(PRIMARY, 0.5)}; }
    #ap-bubble:active { transform: scale(0.95); }
    #ap-bubble svg { width: 24px; height: 24px; fill: white; transition: transform 0.3s ease, opacity 0.3s ease; }
    #ap-bubble .icon-chat { position: absolute; }
    #ap-bubble .icon-close { position: absolute; opacity: 0; transform: rotate(-90deg); }
    #ap-bubble.open .icon-chat { opacity: 0; transform: rotate(90deg); }
    #ap-bubble.open .icon-close { opacity: 1; transform: rotate(0deg); }

    /* Unread badge */
    #ap-badge {
      position: absolute; top: -2px; right: -2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #E24B4A; color: white; font-size: 10px; font-weight: 600;
      display: none; align-items: center; justify-content: center;
      border: 2px solid white;
      animation: ap-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
    }
    #ap-badge.show { display: flex; }
    @keyframes ap-pop { from { transform: scale(0); } to { transform: scale(1); } }

    /* Window */
    #ap-window {
      position: fixed; bottom: 92px; right: 24px; z-index: 99998;
      width: 368px; border-radius: 20px;
      background: #ffffff;
      box-shadow: 0 12px 48px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; pointer-events: none;
      transform: translateY(16px) scale(0.96);
      transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
      max-height: 560px;
    }
    #ap-window.open { opacity: 1; pointer-events: all; transform: translateY(0) scale(1); }

    /* Header */
    #ap-header {
      background: ${PRIMARY};
      padding: 16px 18px 20px;
      position: relative; overflow: hidden;
    }
    #ap-header::before {
      content: ''; position: absolute;
      width: 160px; height: 160px; border-radius: 50%;
      background: rgba(255,255,255,0.06);
      top: -60px; right: -40px;
    }
    #ap-header::after {
      content: ''; position: absolute;
      width: 100px; height: 100px; border-radius: 50%;
      background: rgba(255,255,255,0.06);
      bottom: -40px; left: 20px;
    }
    #ap-header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    #ap-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    #ap-close {
      background: rgba(255,255,255,0.15); border: none; cursor: pointer;
      color: white; width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; line-height: 1; transition: background 0.2s;
    }
    #ap-close:hover { background: rgba(255,255,255,0.25); }
    #ap-header-title { color: white; font-size: 16px; font-weight: 600; letter-spacing: -0.2px; }
    #ap-header-sub { color: rgba(255,255,255,0.8); font-size: 12px; margin-top: 2px; display: flex; align-items: center; gap: 5px; }
    #ap-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; display: inline-block; animation: ap-pulse 2s infinite; }
    @keyframes ap-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Messages */
    #ap-messages {
      flex: 1; overflow-y: auto; padding: 16px 14px;
      display: flex; flex-direction: column; gap: 12px;
      min-height: 200px; max-height: 320px;
      scroll-behavior: smooth;
    }
    #ap-messages::-webkit-scrollbar { width: 3px; }
    #ap-messages::-webkit-scrollbar-thumb { background: #e0e0d8; border-radius: 2px; }

    .ap-msg-wrap { display: flex; flex-direction: column; gap: 3px; animation: ap-slide-in 0.25s ease; }
    .ap-msg-wrap.user { align-items: flex-end; }
    .ap-msg-wrap.assistant { align-items: flex-start; }
    @keyframes ap-slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .ap-msg {
      max-width: 80%; padding: 10px 14px; border-radius: 18px;
      font-size: 14px; line-height: 1.5; word-break: break-word;
    }
    .ap-msg.user { background: ${PRIMARY}; color: white; border-bottom-right-radius: 5px; }
    .ap-msg.assistant { background: #f4f4f1; color: #1a1a1a; border-bottom-left-radius: 5px; }
    .ap-ts { font-size: 10px; color: #b0aea8; padding: 0 4px; }

    /* Typing indicator */
    .ap-typing {
      background: #f4f4f1; border-radius: 18px; border-bottom-left-radius: 5px;
      padding: 12px 16px; display: flex; gap: 5px; align-items: center;
      animation: ap-slide-in 0.25s ease;
    }
    .ap-dot { width: 7px; height: 7px; border-radius: 50%; background: #b0aea8; animation: ap-bounce 1.4s infinite ease-in-out; }
    .ap-dot:nth-child(1) { animation-delay: 0s; }
    .ap-dot:nth-child(2) { animation-delay: 0.2s; }
    .ap-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ap-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

    /* Contact CTA banner */
    #ap-contact-cta {
      margin: 0 14px 8px;
      background: ${hexToRgba(PRIMARY, 0.07)};
      border: 1px solid ${hexToRgba(PRIMARY, 0.15)};
      border-radius: 12px; padding: 10px 14px;
      display: flex; align-items: center; justify-content: space-between;
      animation: ap-slide-in 0.25s ease;
    }
    #ap-contact-cta span { font-size: 12px; color: #555; }
    #ap-contact-cta button {
      font-size: 12px; font-weight: 500; color: ${PRIMARY};
      background: none; border: none; cursor: pointer; padding: 0;
      text-decoration: underline; text-underline-offset: 2px;
      transition: opacity 0.2s;
    }
    #ap-contact-cta button:hover { opacity: 0.7; }

    /* Contact form */
    #ap-contact-form {
      margin: 0 14px 8px; padding: 14px;
      background: #fafaf8; border-radius: 14px;
      border: 1px solid #ebe9e3;
      animation: ap-slide-in 0.25s ease;
      display: flex; flex-direction: column; gap: 8px;
    }
    #ap-contact-form .cf-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
    #ap-contact-form input,
    #ap-contact-form textarea {
      width: 100%; padding: 8px 10px; border-radius: 8px;
      border: 1px solid #e0e0d8; font-size: 13px; font-family: inherit;
      background: white; color: #1a1a1a; outline: none;
      transition: border-color 0.2s;
    }
    #ap-contact-form input:focus,
    #ap-contact-form textarea:focus { border-color: ${PRIMARY}; }
    #ap-contact-form textarea { resize: none; height: 72px; }
    #ap-contact-form .cf-submit {
      background: ${PRIMARY}; color: white; border: none;
      border-radius: 8px; padding: 9px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: opacity 0.2s, transform 0.15s;
    }
    #ap-contact-form .cf-submit:hover { opacity: 0.9; }
    #ap-contact-form .cf-submit:active { transform: scale(0.98); }

    /* Success state */
    #ap-contact-success {
      margin: 0 14px 8px; padding: 14px;
      background: #f0fdf6; border: 1px solid #bbf7d0;
      border-radius: 14px; text-align: center;
      animation: ap-slide-in 0.25s ease;
    }
    #ap-contact-success .cs-icon { font-size: 24px; margin-bottom: 6px; }
    #ap-contact-success .cs-title { font-size: 13px; font-weight: 600; color: #166534; margin-bottom: 3px; }
    #ap-contact-success .cs-sub { font-size: 12px; color: #4ade80; }

    /* Input row */
    #ap-input-row {
      padding: 10px 14px 14px; border-top: 1px solid #f0ede6;
      display: flex; gap: 8px; align-items: flex-end;
    }
    #ap-input {
      flex: 1; border: 1.5px solid #e8e6e0; border-radius: 12px;
      padding: 9px 12px; font-size: 14px; resize: none; outline: none;
      line-height: 1.4; max-height: 100px; font-family: inherit;
      background: #fafaf8; color: #1a1a1a;
      transition: border-color 0.2s, background 0.2s;
    }
    #ap-input:focus { border-color: ${PRIMARY}; background: white; }
    #ap-send {
      width: 38px; height: 38px; border-radius: 12px; border: none;
      background: ${PRIMARY}; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: opacity 0.2s, transform 0.15s;
    }
    #ap-send:hover { opacity: 0.9; }
    #ap-send:active { transform: scale(0.95); }
    #ap-send:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }
    #ap-send svg { width: 16px; height: 16px; fill: white; }

    /* Footer */
    #ap-footer { text-align: center; font-size: 11px; color: #c0bdb7; padding: 0 14px 10px; }
    #ap-footer a { color: inherit; text-decoration: none; }
    #ap-footer a:hover { color: #888; }

    @media (max-width: 420px) {
      #ap-window { width: calc(100vw - 20px); right: 10px; bottom: 82px; }
      #ap-bubble { bottom: 16px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── Time formatter ────────────────────────────────────────────────────────
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'ap-widget';
  root.innerHTML = `
    <button id="ap-bubble" aria-label="Open support chat">
      <span id="ap-badge" aria-hidden="true"></span>
      <svg class="icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      <svg class="icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>

    <div id="ap-window" role="dialog" aria-label="Support chat">
      <div id="ap-header">
        <div id="ap-header-top">
          <div id="ap-avatar">${LOGO ? `<img src="${LOGO}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : '🤖'}</div>
          <button id="ap-close" aria-label="Close">×</button>
        </div>
        <div id="ap-header-title">${TITLE}</div>
        <div id="ap-header-sub"><span id="ap-status-dot"></span> Online · typically replies instantly</div>
      </div>

      <div id="ap-messages" aria-live="polite"></div>

      <div id="ap-contact-cta" style="display:none">
        <span>Can't find what you need?</span>
        <button id="ap-contact-btn">Contact us</button>
      </div>

      <div id="ap-contact-form" style="display:none">
        <div class="cf-title">Send us a message</div>
        <input id="cf-name" type="text" placeholder="Your name" />
        <input id="cf-email" type="email" placeholder="Your email" />
        <textarea id="cf-message" placeholder="How can we help?"></textarea>
        <button class="cf-submit" id="cf-submit">Send message →</button>
      </div>

      <div id="ap-contact-success" style="display:none">
        <div class="cs-icon">✅</div>
        <div class="cs-title">Message sent!</div>
        <div class="cs-sub">We'll get back to you shortly.</div>
      </div>

      <div id="ap-input-row">
        <textarea id="ap-input" rows="1" placeholder="Ask us anything..." aria-label="Message"></textarea>
        <button id="ap-send" aria-label="Send" disabled>
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>

      <div id="ap-footer">Powered by <a href="https://hyperboledigital.com" target="_blank">Hyperbole Digital</a></div>
    </div>
  `;
  document.body.appendChild(root);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const bubble = document.getElementById('ap-bubble');
  const badge = document.getElementById('ap-badge');
  const win = document.getElementById('ap-window');
  const closeBtn = document.getElementById('ap-close');
  const messagesEl = document.getElementById('ap-messages');
  const input = document.getElementById('ap-input');
  const sendBtn = document.getElementById('ap-send');
  const contactCta = document.getElementById('ap-contact-cta');
  const contactBtn = document.getElementById('ap-contact-btn');
  const contactForm = document.getElementById('ap-contact-form');
  const contactSuccess = document.getElementById('ap-contact-success');
  const cfSubmit = document.getElementById('cf-submit');

  // ── Render ────────────────────────────────────────────────────────────────
  function renderMessages() {
    messagesEl.innerHTML = '';
    messages.forEach(m => {
      const wrap = document.createElement('div');
      wrap.className = `ap-msg-wrap ${m.role}`;
      const msg = document.createElement('div');
      msg.className = `ap-msg ${m.role}`;
      msg.textContent = m.content;
      const ts = document.createElement('div');
      ts.className = 'ap-ts';
      ts.textContent = formatTime(m.ts);
      wrap.appendChild(msg);
      wrap.appendChild(ts);
      messagesEl.appendChild(wrap);
    });

    if (isTyping) {
      const dots = document.createElement('div');
      dots.className = 'ap-typing';
      dots.innerHTML = '<div class="ap-dot"></div><div class="ap-dot"></div><div class="ap-dot"></div>';
      messagesEl.appendChild(dots);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show contact CTA after 2+ messages
    if (messages.length >= 3 && !showContactForm && !contactSubmitted) {
      contactCta.style.display = 'flex';
    }
  }

  // ── Toggle ────────────────────────────────────────────────────────────────
  function toggleWindow() {
    isOpen = !isOpen;
    win.classList.toggle('open', isOpen);
    bubble.classList.toggle('open', isOpen);
    if (isOpen) {
      badge.classList.remove('show');
      renderMessages();
      setTimeout(() => input.focus(), 300);
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
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
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      messages.push({ role: 'assistant', content: data.reply, ts: Date.now() });

      // If Claude signals show contact form
      if (data.action === 'show_contact_form') {
        showContactForm = true;
        contactForm.style.display = 'flex';
        contactCta.style.display = 'none';
      }
    } catch {
      messages.push({ role: 'assistant', content: 'Sorry, something went wrong. Please try again or use the contact form below.', ts: Date.now() });
      contactCta.style.display = 'flex';
    } finally {
      isTyping = false;
      if (!isOpen) {
        badge.textContent = '1';
        badge.classList.add('show');
      }
      sendBtn.disabled = false;
      renderMessages();
      input.focus();
    }
  }

  // ── Contact form submit ───────────────────────────────────────────────────
  async function submitContact() {
    const name = document.getElementById('cf-name').value.trim();
    const email = document.getElementById('cf-email').value.trim();
    const message = document.getElementById('cf-message').value.trim();
    if (!email || !message) { alert('Please fill in your email and message.'); return; }

    cfSubmit.textContent = 'Sending...';
    cfSubmit.disabled = true;

    try {
      await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          from: email || SESSION_ID,
          body: `[Contact form] Name: ${name || 'Unknown'} | Email: ${email} | Message: ${message}`
        })
      });
    } catch {}

    contactForm.style.display = 'none';
    contactSuccess.style.display = 'block';
    contactSubmitted = true;

    // After 3s ask if they need more help
    setTimeout(() => {
      contactSuccess.style.display = 'none';
      messages.push({ role: 'assistant', content: "Your message has been sent! 🎉 Is there anything else I can help you with?", ts: Date.now() });
      renderMessages();
    }, 3000);
  }

  // ── Events ────────────────────────────────────────────────────────────────
  bubble.addEventListener('click', toggleWindow);
  closeBtn.addEventListener('click', toggleWindow);

  contactBtn.addEventListener('click', () => {
    showContactForm = true;
    contactCta.style.display = 'none';
    contactForm.style.display = 'flex';
    contactForm.scrollIntoView({ behavior: 'smooth' });
  });

  cfSubmit.addEventListener('click', submitContact);

  input.addEventListener('input', function () {
    sendBtn.disabled = !this.value.trim();
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  sendBtn.addEventListener('click', sendMessage);

  document.addEventListener('click', function (e) {
    if (isOpen && !root.contains(e.target)) toggleWindow();
  });

  renderMessages();
})();