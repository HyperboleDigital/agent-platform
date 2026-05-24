(function () {
  'use strict';

  const script = document.currentScript;
  const CLIENT_ID = script?.getAttribute('data-client-id') || '';
  const API_URL = script?.getAttribute('data-api-url') || 'http://localhost:3001';
  const TITLE = script?.getAttribute('data-title') || 'Support';
  const TAGLINE = script?.getAttribute('data-tagline') || 'You can ask me anything';
  const WELCOME = script?.getAttribute('data-welcome') || "How can I help you today?";
  const LOGO = script?.getAttribute('data-logo') || '';
  const AVATAR_EMOJI = script?.getAttribute('data-avatar-emoji') || '';
  const PROMPT_LABEL = script?.getAttribute('data-prompt') || 'Questions?';

  // ─── Theme colors (override via data-color / data-color-2) ───────────────
  // data-color    → primary brand color (e.g. data-color="#C05B28")
  // data-color-2  → secondary (used in gradients, defaults to primary if not set)
  const COLOR_PRIMARY = script?.getAttribute('data-color') || '#6C5CE7';
  const COLOR_SECONDARY = script?.getAttribute('data-color-2') || COLOR_PRIMARY;

  // ─── Darken helper for hover/active states ───────────────────────────────
  function darken(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }
  const COLOR_DARK = darken(COLOR_PRIMARY, 24);

  // ─── Lighten helper for input backgrounds ────────────────────────────────
  function tint(hex, alpha) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const COLOR_TINT_LIGHT = tint(COLOR_PRIMARY, 0.06);
  const COLOR_TINT_GLOW = tint(COLOR_PRIMARY, 0.15);
  const COLOR_TINT_SHADOW = tint(COLOR_PRIMARY, 0.4);

  const SESSION_ID = 'sess_' + Math.random().toString(36).slice(2);

  let isOpen = false;
  let isAnimating = false;
  let isTyping = false;
  let view = 'chat';
  let messages = [{ role: 'assistant', content: WELCOME, ts: Date.now() }];

  const style = document.createElement('style');
  style.textContent = `
    #ap-widget {
      --p: ${COLOR_PRIMARY};
      --p2: ${COLOR_SECONDARY};
      --p-dark: ${COLOR_DARK};
      --p-light: ${COLOR_TINT_LIGHT};
      --p-glow: ${COLOR_TINT_GLOW};
      --p-shadow: ${COLOR_TINT_SHADOW};
      --text: #1A1B26;
      --muted: #6B7280;
      --faded: #9CA3AF;
      --border: #E5E7EB;
      --bg-input: #F9FAFB;
      --success: #22C55E;
      --white: #ffffff;
    }
    #ap-widget, #ap-widget * {
      box-sizing: border-box; margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased;
      outline: none;
    }
    #ap-widget button:focus-visible { outline: 2px solid var(--p); outline-offset: 2px; }

    /* ─── Prompt label (small chip above the bubble) ────────────────────── */
    #ap-prompt {
      position: fixed; bottom: 100px; right: 30px; z-index: 99998;
      background: var(--p);
      color: white;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 13px; font-weight: 600;
      box-shadow: 0 8px 24px var(--p-shadow), 0 2px 6px rgba(0,0,0,0.08);
      cursor: pointer;
      pointer-events: auto;
      transform: translateY(0);
      animation: ap-prompt-in 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.3s backwards;
      transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease;
    }
    #ap-prompt::after {
      content: '';
      position: absolute;
      bottom: -4px;
      right: 24px;
      width: 10px; height: 10px;
      background: var(--p);
      transform: rotate(45deg);
    }
    #ap-prompt.hidden { opacity: 0; transform: translateY(8px); pointer-events: none; }

    /* When hovering EITHER the bubble or the prompt, lift both */
    #ap-bubble:hover ~ #ap-prompt,
    #ap-prompt:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 32px var(--p-shadow), 0 4px 8px rgba(0,0,0,0.1);
    }
    #ap-prompt:hover ~ #ap-bubble,
    #ap-widget:has(#ap-prompt:hover) #ap-bubble {
      transform: translateY(-3px) scale(1.05);
      box-shadow: 0 16px 44px var(--p-shadow), 0 6px 14px rgba(0,0,0,0.1);
    }
    @keyframes ap-prompt-in {
      from { opacity: 0; transform: translateY(8px) scale(0.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ─── Bubble (the FAB that opens the chat) ───────────────────────────── */
    /* Avatar inside is the same element that morphs to the header position */
    #ap-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, var(--p) 0%, var(--p2) 100%);
      border: none; cursor: pointer;
      box-shadow: 0 12px 36px var(--p-shadow), 0 4px 12px rgba(0,0,0,0.08);
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 24px; font-weight: 700;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s;
      overflow: hidden;
    }
    #ap-bubble:hover { transform: translateY(-3px) scale(1.05); }
    #ap-bubble:active { transform: scale(0.92); }
    #ap-bubble.morphing {
      pointer-events: none;
      transition: transform 0.45s cubic-bezier(0.5, 0, 0.2, 1);
    }
    #ap-bubble.hidden { opacity: 0; transform: scale(0); pointer-events: none; }
    #ap-bubble img { width: 52%; height: 52%; object-fit: contain; display: block; transition: opacity 0.3s ease; }

    /* ─── Window ─────────────────────────────────────────────────────────── */
    #ap-window {
      position: fixed; bottom: 24px; right: 24px; z-index: 99998;
      width: 400px; height: 640px; max-height: calc(100vh - 48px);
      border-radius: 28px; background: var(--white);
      box-shadow: 0 24px 64px var(--p-glow), 0 8px 24px rgba(0,0,0,0.08);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; pointer-events: none;
      transform: translateY(20px) scale(0.96);
      transform-origin: bottom right;
      transition: opacity 0.35s ease, transform 0.4s cubic-bezier(0.34,1.4,0.6,1);
    }
    #ap-window.open { opacity: 1; pointer-events: all; transform: translateY(0) scale(1); }

    /* ─── Header with gradient ───────────────────────────────────────────── */
    #ap-header {
      background: linear-gradient(135deg, var(--p) 0%, var(--p2) 100%);
      padding: 22px 22px 26px;
      color: white; flex-shrink: 0;
      position: relative;
    }
    .ap-h-row { display: flex; align-items: center; gap: 14px; }
    #ap-h-avatar {
      width: 64px; height: 64px; border-radius: 50%;
      background: transparent;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 24px; font-weight: 700;
      flex-shrink: 0;
    }
    #ap-h-avatar img { width: 52%; height: 52%; object-fit: contain; display: block; }
    .ap-h-text { flex: 1; min-width: 0; }
    #ap-title { font-size: 17px; font-weight: 700; line-height: 1.2; letter-spacing: -0.2px; }
    #ap-tagline { font-size: 13px; opacity: 0.9; margin-top: 2px; }
    .ap-h-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .ap-h-btn {
      width: 32px; height: 32px; border-radius: 10px; border: none;
      background: rgba(255,255,255,0.15); color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, transform 0.15s;
    }
    .ap-h-btn:hover { background: rgba(255,255,255,0.25); }
    .ap-h-btn:active { transform: scale(0.9); }
    .ap-h-btn svg { width: 18px; height: 18px; fill: white; }

    /* ─── Chat view ──────────────────────────────────────────────────────── */
    #ap-chat-view { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #FBFBFD; }
    #ap-messages {
      flex: 1; overflow-y: auto;
      padding: 24px 20px 12px;
      display: flex; flex-direction: column; gap: 4px;
      scroll-behavior: smooth;
      background: #FBFBFD;
    }
    #ap-messages::-webkit-scrollbar { width: 0; }

    .ap-time-divider {
      text-align: center; font-size: 11px; color: var(--faded);
      font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase;
      margin: 12px 0 10px;
    }
    .ap-time-divider:first-child { margin-top: 0; }

    .ap-msg-group { display: flex; flex-direction: column; gap: 3px; margin-bottom: 14px; }
    .ap-msg-group.user { align-items: flex-end; }
    .ap-msg-group.assistant { align-items: flex-start; }
    .ap-msg-group:last-child { margin-bottom: 0; }

    .ap-msg {
      max-width: 80% !important;
      padding: 14px 18px !important;
      font-size: 15px !important;
      line-height: 1.5 !important;
      word-wrap: break-word;
      animation: ap-msg-in 0.4s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes ap-msg-in {
      from { opacity: 0; transform: translateY(10px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ap-msg.user {
      background: var(--p) !important;
      color: white !important;
      border-radius: 20px 20px 6px 20px;
      box-shadow: none !important;
    }
    .ap-msg.user.middle { border-radius: 20px 6px 6px 20px; }
    .ap-msg.user.last { border-radius: 20px 6px 20px 20px; }

    .ap-msg.assistant {
      background: var(--white) !important;
      color: var(--text) !important;
      border-radius: 20px 20px 20px 6px;
      border: 1px solid var(--border) !important;
      box-shadow: none !important;
    }
    .ap-msg.assistant.middle { border-radius: 6px 20px 20px 6px; }
    .ap-msg.assistant.last { border-radius: 6px 20px 20px 20px; }

    /* Typing */
    .ap-typing {
      background: var(--white);
      border-radius: 20px 20px 20px 6px;
      padding: 16px 20px !important;
      display: inline-flex; gap: 5px; align-items: center;
      animation: ap-msg-in 0.3s ease;
      border: 1px solid var(--border);
      box-shadow: none;
    }
    .ap-tdot { width: 7px; height: 7px; border-radius: 50%; background: var(--p); animation: ap-typing 1.2s infinite ease-in-out; }
    .ap-tdot:nth-child(2) { animation-delay: 0.15s; }
    .ap-tdot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes ap-typing { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }

    /* ─── Chip grid (2-column layout like the reference) ─────────────────── */
    #ap-chips {
      padding: 4px 20px 16px;
      display: flex; flex-wrap: wrap; gap: 8px;
      background: #FBFBFD;
    }
    .ap-chip {
      font-size: 13px !important;
      padding: 9px 16px !important;
      border-radius: 999px;
      background: var(--white); border: 1.5px solid var(--p);
      color: var(--p); cursor: pointer; font-weight: 500;
      text-decoration: none !important;
      line-height: 1.2 !important;
      white-space: nowrap;
      transition: all 0.2s ease;
      animation: ap-chip-in 0.4s cubic-bezier(0.34,1.56,0.64,1) backwards;
    }
    .ap-chip:nth-child(1) { animation-delay: 0.2s; }
    .ap-chip:nth-child(2) { animation-delay: 0.3s; }
    .ap-chip:nth-child(3) { animation-delay: 0.4s; }
    .ap-chip:nth-child(4) { animation-delay: 0.5s; }
    @keyframes ap-chip-in {
      from { opacity: 0; transform: translateY(8px) scale(0.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ap-chip:hover {
      background: var(--p);
      color: white;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px var(--p-glow);
    }
    .ap-chip:active { transform: scale(0.96); }

    /* ─── Input ──────────────────────────────────────────────────────────── */
    #ap-input-wrap { padding: 4px 20px 20px; flex-shrink: 0; background: #FBFBFD; }
    #ap-input-row {
      display: flex; align-items: center; gap: 8px;
      background: var(--bg-input);
      border: 2px solid transparent;
      border-radius: 999px;
      padding: 4px 4px 4px 18px;
      transition: background 0.2s, border-color 0.2s;
    }
    #ap-input-row.focused { background: var(--white); border-color: var(--p); box-shadow: 0 0 0 3px var(--p-glow); }
    #ap-input {
      flex: 1; border: none; background: transparent;
      padding: 10px 0; font-size: 15px; resize: none;
      line-height: 1.4; max-height: 100px; font-family: inherit; color: var(--text);
    }
    #ap-input::placeholder { color: var(--faded); }
    #ap-send {
      width: 38px; height: 38px; border-radius: 50%; border: none;
      background: var(--p);
      cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: opacity 0.2s, transform 0.2s, background 0.2s;
    }
    #ap-send:hover:not(:disabled) { transform: scale(1.08); }
    #ap-send:active:not(:disabled) { transform: scale(0.92); }
    #ap-send:disabled { opacity: 0.35; cursor: not-allowed; }
    #ap-send svg { width: 16px; height: 16px; fill: white; transform: translateX(-1px); }

    /* ─── Contact view ───────────────────────────────────────────────────── */
    #ap-contact {
      flex: 1; display: flex; flex-direction: column;
      padding: 24px; background: var(--white); overflow-y: auto;
    }
    .cf-back {
      align-self: flex-start !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      color: var(--muted) !important;
      background: transparent !important;
      border: none !important;
      cursor: pointer !important;
      padding: 8px 12px 8px 4px !important;
      border-radius: 8px !important;
      margin-bottom: 20px !important;
      transition: color 0.2s;
    }
    .cf-back:hover { color: var(--p); }
    .cf-back svg { width: 18px; height: 18px; fill: currentColor; }
    .cf-header { margin-bottom: 24px !important; }
    .cf-title {
      font-size: 22px !important;
      font-weight: 700 !important;
      color: var(--text) !important;
      letter-spacing: -0.4px !important;
      line-height: 1.25 !important;
      margin: 0 !important;
    }
    .cf-sub {
      font-size: 14px !important;
      color: var(--muted) !important;
      margin-top: 8px !important;
      line-height: 1.5 !important;
    }
    .cf-field {
      margin-bottom: 14px !important;
      display: block !important;
    }
    .cf-field:last-of-type { margin-bottom: 24px !important; }
    .cf-label {
      display: block !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      color: var(--text) !important;
      margin-bottom: 6px !important;
      line-height: 1.2 !important;
    }
    .cf-field input, .cf-field textarea {
      width: 100% !important;
      padding: 14px 16px !important;
      border-radius: 12px !important;
      border: 1.5px solid var(--border) !important;
      font-size: 15px !important;
      font-family: inherit !important;
      background: var(--white) !important;
      color: var(--text) !important;
      transition: border-color 0.15s, box-shadow 0.15s;
      min-height: 48px !important;
      line-height: 1.4 !important;
    }
    .cf-field input::placeholder, .cf-field textarea::placeholder { color: var(--faded) !important; }
    .cf-field input:focus, .cf-field textarea:focus {
      border-color: var(--p) !important;
      box-shadow: 0 0 0 3px var(--p-glow) !important;
    }
    .cf-field textarea {
      resize: none !important;
      min-height: 110px !important;
      line-height: 1.5 !important;
      padding: 14px 16px !important;
    }
    .cf-submit {
      width: 100%; padding: 16px; border-radius: 12px; border: none;
      background: linear-gradient(135deg, var(--p) 0%, var(--p2) 100%);
      color: white; font-size: 15px; font-weight: 600; cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
      min-height: 52px;
    }
    .cf-submit:hover:not(:disabled) { opacity: 0.92; }
    .cf-submit:active { transform: scale(0.98); }
    .cf-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ─── Success ────────────────────────────────────────────────────────── */
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
    #ap-success h3 { font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    #ap-success p { font-size: 14px; color: var(--muted); line-height: 1.5; max-width: 280px; margin-bottom: 24px; }
    #ap-success button {
      padding: 12px 24px; border-radius: 12px; border: none;
      background: linear-gradient(135deg, var(--p) 0%, var(--p2) 100%);
      color: white; font-size: 14px; font-weight: 600; cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
    }
    #ap-success button:hover { opacity: 0.92; }
    #ap-success button:active { transform: scale(0.96); }

    #ap-footer { text-align: center; font-size: 11px; color: var(--faded); padding: 6px 20px 12px; background: #FBFBFD; flex-shrink: 0; }
    #ap-footer a { color: inherit; text-decoration: none; font-weight: 500; }
    #ap-footer a:hover { color: var(--p); }

    @media (max-width: 440px) {
      #ap-window { width: calc(100vw - 16px); right: 8px; bottom: 8px; height: calc(100vh - 16px); max-height: none; }
      #ap-bubble { bottom: 16px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ─── Avatar content (logo > emoji > initial) ──────────────────────────────
  function avatarHTML() {
    if (LOGO) return `<img src="${LOGO}" alt="${TITLE}" />`;
    if (AVATAR_EMOJI) return AVATAR_EMOJI;
    return TITLE.charAt(0).toUpperCase();
  }

  const root = document.createElement('div');
  root.id = 'ap-widget';
  root.innerHTML = `
    <button id="ap-bubble" aria-label="Open chat">${avatarHTML()}</button>
    <div id="ap-prompt" role="button" tabindex="0">${PROMPT_LABEL}</div>
    <div id="ap-window" role="dialog">
      <div id="ap-header">
        <div class="ap-h-row">
          <div id="ap-h-avatar">${avatarHTML()}</div>
          <div class="ap-h-text">
            <div id="ap-title">${TITLE}</div>
            <div id="ap-tagline">${TAGLINE}</div>
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
  const promptLabel = document.getElementById('ap-prompt');
  const win = document.getElementById('ap-window');
  const closeBtn = document.getElementById('ap-close-btn');
  const contactTrigger = document.getElementById('ap-contact-trigger');
  const messagesEl = document.getElementById('ap-messages');
  const chipsEl = document.getElementById('ap-chips');
  const input = document.getElementById('ap-input');
  const inputRow = document.getElementById('ap-input-row');
  const sendBtn = document.getElementById('ap-send');
  const headerAvatar = document.getElementById('ap-h-avatar');
  const chatView = document.getElementById('ap-chat-view');
  const contactView = document.getElementById('ap-contact');
  const successView = document.getElementById('ap-success');
  const cfSubmit = document.getElementById('cf-submit');
  const cfBack = document.getElementById('cf-back-btn');
  const backToChat = document.getElementById('ap-back-to-chat');

  // ─── FLIP morph animation: bubble → header avatar (and back) ──────────────
  function morphBubbleToHeader() {
    if (isAnimating) return;
    isAnimating = true;

    // Get start position of bubble
    const bubbleRect = bubble.getBoundingClientRect();
    win.classList.add('open');
    headerAvatar.offsetHeight; // force layout
    const targetRect = headerAvatar.getBoundingClientRect();

    // Pure translation — same size start and end, so the logo just slides into the header
    const dx = targetRect.left + targetRect.width/2 - (bubbleRect.left + bubbleRect.width/2);
    const dy = targetRect.top + targetRect.height/2 - (bubbleRect.top + bubbleRect.height/2);

    // Hide header avatar — bubble takes its place during the morph
    headerAvatar.style.transition = 'none';
    headerAvatar.style.opacity = '0';

    bubble.classList.add('morphing');
    bubble.style.transform = `translate(${dx}px, ${dy}px)`;
    bubble.style.boxShadow = 'none';

    // After morph completes, swap bubble out for real header avatar (instant, no fade)
    setTimeout(() => {
      headerAvatar.style.opacity = '1';
      bubble.classList.add('hidden');
      bubble.classList.remove('morphing');
      bubble.style.transform = '';
      bubble.style.boxShadow = '';
      isAnimating = false;
    }, 450);
  }

  function morphHeaderToBubble() {
    if (isAnimating) return;
    isAnimating = true;

    const targetRect = headerAvatar.getBoundingClientRect();

    // Hide the header avatar instantly — bubble will take its visual place
    headerAvatar.style.transition = 'none';
    headerAvatar.style.opacity = '0';

    // Pure translation back — no scale
    const winRect = bubble.getBoundingClientRect();
    const dx = targetRect.left + targetRect.width/2 - (winRect.left + 32);
    const dy = targetRect.top + targetRect.height/2 - (winRect.top + 32);

    // Place bubble at header position instantly
    bubble.classList.remove('hidden');
    bubble.style.transition = 'none';
    bubble.style.transform = `translate(${dx}px, ${dy}px)`;
    bubble.offsetHeight; // force reflow

    // Now animate the bubble back to its resting bottom-right position
    bubble.classList.add('morphing');
    bubble.style.transform = '';

    // Close the chat window in parallel
    win.classList.remove('open');

    setTimeout(() => {
      bubble.classList.remove('morphing');
      bubble.style.transition = '';
      headerAvatar.style.opacity = '1';
      headerAvatar.style.transition = '';
      isAnimating = false;
    }, 500);
  }

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
      lastRole = m.role; lastTs = m.ts;
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
    chipsEl.style.display = 'grid';
    chipsEl.innerHTML = `
      <button class="ap-chip" data-msg="What services do you offer?">What do you offer?</button>
      <button class="ap-chip" data-msg="How much does it cost?">Pricing</button>
      <button class="ap-chip" data-msg="Can I book a call?">Book a call</button>
      <button class="ap-chip" data-msg="I want to contact support">Contact us</button>
    `;
    chipsEl.querySelectorAll('.ap-chip').forEach(c => {
      c.addEventListener('click', (e) => { e.stopPropagation(); input.value = c.dataset.msg; sendMessage(); });
    });
  }

  function setView(v) {
    view = v;
    chatView.style.setProperty('display', v === 'chat' ? 'flex' : 'none', 'important');
    contactView.style.setProperty('display', v === 'contact' ? 'flex' : 'none', 'important');
    successView.style.setProperty('display', v === 'success' ? 'flex' : 'none', 'important');
  }

  function openChat() {
    if (isOpen || isAnimating) return;
    isOpen = true;
    promptLabel.classList.add('hidden');
    renderMessages();
    morphBubbleToHeader();
    setTimeout(() => { if (view === 'chat') input.focus(); }, 600);
  }

  function closeChat() {
    if (!isOpen || isAnimating) return;
    isOpen = false;
    morphHeaderToBubble();
    // Fade prompt back in once the bubble is settled
    setTimeout(() => promptLabel.classList.remove('hidden'), 400);
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
      messages.push({ role: 'assistant', content: "I'm having trouble connecting. Try the contact form and we'll reach out personally.", ts: Date.now() });
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
        body: JSON.stringify({
          clientId: CLIENT_ID, from: email,
          body: `[Contact form] Name: ${name || 'Unknown'} | Email: ${email} | Message: ${message}`
        })
      });
    } catch {}
    setView('success');
    cfSubmit.textContent = 'Send message'; cfSubmit.disabled = false;
  }

  root.addEventListener('click', e => e.stopPropagation());
  bubble.addEventListener('click', openChat);
  promptLabel.addEventListener('click', openChat);
  promptLabel.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(); } });
  closeBtn.addEventListener('click', closeChat);
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