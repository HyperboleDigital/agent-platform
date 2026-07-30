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
  const INPUT_PLACEHOLDER = script?.getAttribute('data-placeholder') || 'Type a message...';

  // ─── Teaser bubble prompts (rotate above the closed bubble) ──────────────
  // `data-prompts` takes precedence — pipe-separated short questions, e.g.
  // data-prompts="What's your pricing?|How does Acme work?|Can I book a call?"
  // Falls back to the older single-string `data-prompt`, then to a generic
  // default set (client-branded via TITLE) so every install has at least 5.
  const promptsAttr = script?.getAttribute('data-prompts')
  const singlePromptAttr = script?.getAttribute('data-prompt')
  const PROMPT_LABELS = promptsAttr
    ? promptsAttr.split('|').map(s => s.trim()).filter(Boolean)
    : singlePromptAttr
      ? [singlePromptAttr]
      : [
          'Questions?',
          "What's your pricing?",
          `How does ${TITLE} work?`,
          'Can I book a call?',
          'Need support?'
        ]

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

  // ─── ANIMATION TUNING — adjust these to taste ──────────────────────────────
  const ANIM = {
    // How long the bubble takes to fly to/from the header (ms)
    morphDuration: 450,
    // Easing curve for the morph (cubic-bezier values)
    morphEasing: 'cubic-bezier(0.5, 0, 0.2, 1)',
    // Delay before measuring header position (ms) — lets the window animation settle
    measureDelay: 50,
    // How long the chat window takes to open (ms)
    windowDuration: 400,
    // Fade duration when bubble swaps to real header avatar at end of morph (ms)
    swapFade: 150,
    // Fade duration for the prompt bubble showing/hiding (ms)
    bubbleFade: 200,
    // ── Position fine-tuning (as % of header avatar size, scales with layout) ──
    // Expressed as fractions: 0.1 = 10% of avatar width/height.
    // If swap skips left, make landingOffsetX more positive. If skips up, more positive Y.
    landingOffsetX: 0,
    landingOffsetY: 0
  };

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
    /* transform-origin bottom-right = the corner nearest the icon, so scale
       animations read as the chip emerging from / retracting into the icon. */
    #ap-prompt {
      position: fixed; bottom: 100px; right: 30px; z-index: 99998;
      background: var(--p);
      color: white;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 13px; font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 8px 24px var(--p-shadow), 0 2px 6px rgba(0,0,0,0.08);
      pointer-events: none;
      user-select: none;
      transform-origin: bottom right;
    }
    /* Start collapsed into the icon; JS pops it out shortly after mount. */
    #ap-prompt.ap-prompt-initial { opacity: 0; transform: scale(0.2) translate(10px, 22px); }
    #ap-prompt::after {
      content: '';
      position: absolute;
      bottom: -4px;
      right: 24px;
      width: 10px; height: 10px;
      background: var(--p);
      transform: rotate(45deg);
    }
    /* Retract: shrink + slide down-right into the icon, then fade. Ease-in so
       it accelerates as it "goes in". */
    #ap-prompt.ap-prompt-retract {
      opacity: 0;
      transform: scale(0.2) translate(10px, 22px);
      transition: opacity 0.24s ease-in, transform 0.26s cubic-bezier(0.5, 0, 0.75, 0);
    }
    /* Pop: spring back out of the icon, like a new message surfacing. */
    #ap-prompt.ap-prompt-pop {
      animation: ap-prompt-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    #ap-prompt.hidden { opacity: 0; transform: scale(0.2) translate(10px, 22px); pointer-events: none; transition: opacity 0.2s ease, transform 0.2s ease; }
    #ap-prompt-text { display: inline-block; }

    @keyframes ap-prompt-pop {
      0%   { opacity: 0; transform: scale(0.2) translate(10px, 22px); }
      55%  { opacity: 1; transform: scale(1.06) translate(0, 0); }
      100% { opacity: 1; transform: scale(1) translate(0, 0); }
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
    #ap-bubble:hover + #ap-prompt {
      transform: translateY(-3px);
      box-shadow: 0 12px 32px var(--p-shadow), 0 4px 8px rgba(0,0,0,0.1);
    }
    #ap-bubble:active { transform: scale(0.92); }

    #ap-bubble.hidden { opacity: 0; pointer-events: none; transform: scale(0.7); }
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
      transition: opacity ${ANIM.windowDuration * 0.875}ms ease, transform ${ANIM.windowDuration}ms cubic-bezier(0.34,1.4,0.6,1);
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

    .ap-msg-group { display: flex; flex-direction: column; gap: 3px; margin-bottom: 20px; }
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
    /* Structured assistant content: keep paragraphs/lists tight in the bubble */
    .ap-msg p { margin: 0 0 8px 0 !important; }
    .ap-msg p:last-child { margin-bottom: 0 !important; }
    .ap-msg .ap-list { margin: 4px 0 8px 0 !important; padding-left: 20px !important; }
    .ap-msg .ap-list:last-child { margin-bottom: 0 !important; }
    .ap-msg .ap-list li { margin: 2px 0 !important; }
    .ap-msg strong { font-weight: 700 !important; }
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
      /* Render regular-weight body text at full darkness instead of the thinned,
         grey look macOS grayscale-AA gives it — so paragraphs match the weight
         of bold labels/bullets and the bubble reads as one consistent color. */
      -webkit-font-smoothing: auto !important;
      -moz-osx-font-smoothing: auto !important;
    }
    .ap-msg.assistant p, .ap-msg.assistant li { color: var(--text) !important; }
    .ap-msg.assistant.middle { border-radius: 6px 20px 20px 6px; }
    .ap-msg.assistant.last { border-radius: 6px 20px 20px 20px; }

    /* Inline contact/intake form — reuses the contact view's cf-* classes so it
       is pixel-identical to the form the header contact button opens. Only the
       bubble width, optional-label, error, and confirmation are widget-specific. */
    .ap-msg.assistant.ap-form-msg { max-width: 94% !important; width: 100%; }
    .ap-ef-opt { font-weight: 400; color: var(--faded); }
    .ap-ef-error { color: #DC2626; font-size: 12.5px; margin-top: 8px; }
    .ap-ef-error:empty { display: none; }
    .ap-ef-done { font-size: 14px; line-height: 1.5; color: var(--text); }

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
    <div id="ap-prompt" class="ap-prompt-initial" aria-hidden="true"><span id="ap-prompt-text">${PROMPT_LABELS[0]}</span></div>
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
            <textarea id="ap-input" rows="1" placeholder="${INPUT_PLACEHOLDER}"></textarea>
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
      
    </div>
  `;
  document.body.appendChild(root);

  const bubble = document.getElementById('ap-bubble');
  const promptLabel = document.getElementById('ap-prompt');
  const promptTextEl = document.getElementById('ap-prompt-text');
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

  // ─── Simple fade transition: bubble fades out, window opens ───────────────
  function morphBubbleToHeader() {
    if (isAnimating) return;
    isAnimating = true;

    // Fade out the bubble (opacity only — no scale issues)
    bubble.style.transition = `opacity ${ANIM.bubbleFade}ms ease-out, transform ${ANIM.bubbleFade}ms ease-out`;
    bubble.style.opacity = '0';
    bubble.style.transform = 'scale(0.7)';
    // Also fade out prompt label so it doesn't linger
    promptLabel.classList.add('hidden');

    // Open the window in parallel
    win.classList.add('open');

    setTimeout(() => {
      bubble.classList.add('hidden');
      isAnimating = false;
    }, ANIM.windowDuration);
  }

  function morphHeaderToBubble() {
    if (isAnimating) return;
    isAnimating = true;

    // Close the chat window
    win.classList.remove('open');

    // Restore header avatar visibility (for next open)
    headerAvatar.style.transition = 'none';
    headerAvatar.style.opacity = '1';

    // Fade bubble back in
    bubble.classList.remove('hidden');
    bubble.style.transition = `opacity ${ANIM.bubbleFade}ms ease-out, transform ${ANIM.bubbleFade}ms ease-out`;
    bubble.style.opacity = '1';
    bubble.style.transform = '';

    setTimeout(() => {
      bubble.style.transition = '';
      isAnimating = false;
    }, ANIM.windowDuration);
  }

  // ─── Rotate the teaser bubble through PROMPT_LABELS while closed ─────────
  // The current chip retracts INTO the icon, then the next question pops back
  // OUT of it — imitating an incoming chat message surfacing.
  let promptIndex = 0;
  function rotatePrompt() {
    if (isOpen || PROMPT_LABELS.length < 2) return;
    promptLabel.classList.remove('ap-prompt-pop');
    promptLabel.classList.add('ap-prompt-retract');
    setTimeout(() => {
      promptIndex = (promptIndex + 1) % PROMPT_LABELS.length;
      promptTextEl.textContent = PROMPT_LABELS[promptIndex];
      promptLabel.classList.remove('ap-prompt-retract');
      // Force a reflow so removing retract + adding pop restarts the animation
      // cleanly rather than the browser collapsing them into no change.
      void promptLabel.offsetWidth;
      promptLabel.classList.add('ap-prompt-pop');
    }, 280);
  }
  // Clear the pop class once it finishes so a later re-add re-triggers it.
  promptLabel.addEventListener('animationend', e => {
    if (e.animationName === 'ap-prompt-pop') promptLabel.classList.remove('ap-prompt-pop');
  });
  // Initial entrance: pop out of the icon a beat after mount (once the window
  // open/settle animation has calmed down).
  setTimeout(() => {
    if (isOpen) return;
    promptLabel.classList.remove('ap-prompt-initial');
    void promptLabel.offsetWidth;
    promptLabel.classList.add('ap-prompt-pop');
  }, 600);
  if (PROMPT_LABELS.length > 1) setInterval(rotatePrompt, 3500);

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

  // Minimal, XSS-safe formatter for assistant replies. Escapes ALL HTML first,
  // then applies a tiny allow-list of markdown: **bold**, "- " bullet lists,
  // and line breaks. Never inserts anything derived from raw model output as
  // HTML without escaping it first.
  function formatAssistant(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = String(text).split(/\r?\n/);
    let html = '';
    let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      if (heading) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p class="ap-heading"><strong>' + inline(heading[1]) + '</strong></p>';
      } else if (bullet) {
        if (!inList) { html += '<ul class="ap-list">'; inList = true; }
        html += '<li>' + inline(bullet[1]) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line) html += '<p>' + inline(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html || esc(String(text));

    // Bold only, on already-escaped text.
    function inline(s) {
      return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Copy for the inline email form, keyed by why it's showing (the chat intent),
  // so the visitor always knows what they're submitting for and the saved lead
  // records it. `btn` is the button label; `donePre`/`donePost` wrap the email
  // in the confirmation; `msg` is the summary stored on the lead.
  // `reason` is the human-readable escalation reason sent to the team's
  // notification (email subject + "Reason:" line), so a demo request reads as a
  // demo request — not a generic "requested a human".
  const REASON_COPY = {
    lead:     { title: 'Let’s set up your demo', sub: 'Drop your details and we’ll reach out to get it scheduled.', btn: 'Request demo', donePre: 'Perfect — your demo request is in! 🎉 We’ll reach out at ', donePost: ' to get it scheduled.', reason: 'Visitor requested a demo' },
    booking:  { title: 'Let’s book your call', sub: 'Leave your details and we’ll set up a time.', btn: 'Book call', donePre: 'Got it! 🎉 We’ll email ', donePost: ' to arrange your call.', reason: 'Visitor wants to book a call' },
    escalate: { title: 'Connect with our team', sub: 'Leave your details and a teammate will follow up.', btn: 'Send', donePre: 'Thanks! 🙌 A teammate will follow up with you at ', donePost: ' shortly.', reason: 'Visitor asked to speak with a human' },
    contact:  { title: 'Get in touch', sub: 'Leave a message and we’ll get back to you shortly.', btn: 'Send message', donePre: 'Thanks! 🎉 We’ll be in touch at ', donePost: ' soon.', reason: 'Visitor reached out via the contact form' },
    default:  { title: 'Get in touch', sub: 'Leave your details and we’ll reach out.', btn: 'Send', donePre: 'Perfect — got it! 🎉 We’ll be in touch at ', donePost: ' shortly.', reason: 'Visitor requested to be contacted' }
  };
  const copyFor = (m) => REASON_COPY[m.reason] || REASON_COPY.default;

  // Renders the inline contact/intake form (name + email + message) — or its
  // submitted confirmation — into an assistant bubble. Rewired on every render
  // since renderMessages rebuilds the DOM; per-field state lives on `m`.
  function renderEmailForm(div, m) {
    const copy = copyFor(m);
    if (m.submitted) {
      div.innerHTML = '<div class="ap-ef-done"><span class="pre"></span><strong></strong><span class="post"></span></div>';
      div.querySelector('.pre').textContent = copy.donePre;
      div.querySelector('strong').textContent = m.email;
      div.querySelector('.post').textContent = copy.donePost;
      return;
    }
    // Reuses the contact form's cf-* classes so the inline form is pixel-identical
    // to the one the header contact button opens.
    div.innerHTML =
      '<div class="cf-header"><div class="cf-title"></div><div class="cf-sub"></div></div>' +
      '<div class="cf-field"><label class="cf-label">Name</label><input class="ap-ef-name" type="text" placeholder="Jane Smith" autocomplete="name" /></div>' +
      '<div class="cf-field"><label class="cf-label">Email</label><input class="ap-ef-input" type="email" placeholder="jane@company.com" autocomplete="email" /></div>' +
      '<div class="cf-field"><label class="cf-label">Message <span class="ap-ef-opt">(optional)</span></label><textarea class="ap-ef-msg" placeholder="Anything we should know?"></textarea></div>' +
      '<button class="cf-submit" type="button"></button>' +
      '<div class="ap-ef-error"></div>';
    div.querySelector('.cf-title').textContent = copy.title;
    div.querySelector('.cf-sub').textContent = copy.sub;
    const nameEl = div.querySelector('.ap-ef-name');
    const emailEl = div.querySelector('.ap-ef-input');
    const msgEl = div.querySelector('.ap-ef-msg');
    const btn = div.querySelector('.cf-submit');
    const err = div.querySelector('.ap-ef-error');
    btn.textContent = copy.btn;
    nameEl.value = m.name || ''; emailEl.value = m.value || ''; msgEl.value = m.msg || '';
    if (m.error) err.textContent = m.error;
    if (m.submitting) { btn.textContent = 'Sending…'; btn.disabled = true; nameEl.disabled = emailEl.disabled = msgEl.disabled = true; }
    const submit = () => submitEmailForm(m, { name: nameEl.value.trim(), email: emailEl.value.trim(), msg: msgEl.value.trim() });
    btn.addEventListener('click', submit);
    emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    if (!m._focusedOnce) { m._focusedOnce = true; setTimeout(() => (m.name ? emailEl : nameEl).focus(), 50); }
  }

  async function submitEmailForm(m, fields) {
    if (m.submitting || m.submitted) return;
    m.name = fields.name; m.value = fields.email; m.msg = fields.msg;
    if (!EMAIL_RE.test(fields.email)) { m.error = 'Please enter a valid email address.'; renderMessages(); return; }
    m.error = ''; m.submitting = true; renderMessages();
    try {
      // Reuses the /contact lead endpoint (logs the lead + notifies a human).
      // `reason` carries WHY they submitted (demo / call / follow-up) so the
      // team's notification says exactly that instead of a generic escalation.
      const res = await fetch(`${API_URL}/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          name: fields.name || undefined,
          email: fields.email,
          message: fields.msg || '(No additional message provided.)',
          reason: copyFor(m).reason
        })
      });
      if (!res.ok) throw new Error();
      m.submitted = true; m.email = fields.email;
    } catch {
      m.error = 'Couldn’t send just now — please try again.';
    } finally {
      m.submitting = false; renderMessages();
    }
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
        // User messages stay plain text; assistant messages get light,
        // XSS-safe formatting (bold, bullet lists, line breaks) so structured
        // replies actually render instead of showing raw ** and - .
        if (m.type === 'emailForm') {
          div.classList.add('ap-form-msg');
          renderEmailForm(div, m);
        } else if (m.role === 'assistant') {
          div.innerHTML = formatAssistant(m.content);
        } else {
          div.textContent = m.content;
        }
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
    // Drop any in-flight rotation state so .hidden's transform wins cleanly.
    promptLabel.classList.remove('ap-prompt-retract', 'ap-prompt-pop');
    promptLabel.classList.add('hidden');
    renderMessages();
    morphBubbleToHeader();
    setTimeout(() => { if (view === 'chat') input.focus(); }, 600);
  }

  function closeChat() {
    if (!isOpen || isAnimating) return;
    isOpen = false;
    morphHeaderToBubble();
    // Pop the prompt back out of the icon once the bubble has settled.
    setTimeout(() => {
      if (isOpen) return;
      promptLabel.classList.remove('hidden', 'ap-prompt-initial', 'ap-prompt-retract');
      void promptLabel.offsetWidth;
      promptLabel.classList.add('ap-prompt-pop');
    }, 400);
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
      // Lead capture without an email → show a lightweight inline email form as
      // the next bubble (no view switch, no separate button) so the visitor can
      // submit right in the conversation.
      if (data.action === 'show_contact_form') {
        // Carry the intent (lead/booking/escalate) so the form's label,
        // confirmation, and the saved lead all reflect WHY they're submitting.
        messages.push({ role: 'assistant', type: 'emailForm', reason: data.intent, submitted: false, ts: Date.now() + 1 });
      }
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
      // Explicit "I want a human" — goes to the escalation endpoint, not the agent.
      await fetch(`${API_URL}/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, name: name || undefined, email, message, reason: 'Visitor reached out via the contact form' })
      });
    } catch {}
    setView('success');
    cfSubmit.textContent = 'Send message'; cfSubmit.disabled = false;
  }

  root.addEventListener('click', e => e.stopPropagation());
  bubble.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);
  // The header contact button opens the full contact form view.
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