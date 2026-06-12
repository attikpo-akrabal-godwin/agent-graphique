/**
 * MascotChat — fenêtre de chat texte pour envoyer des instructions à la mascotte.
 * Complète le push-to-talk : on tape un message, il part dans le même pipeline
 * (handleUserIntent → background → séquence d'actions). Les paroles de la mascotte
 * sont reflétées dans le fil de discussion.
 */
(() => {
  'use strict';

  let onSendCb = null;
  let panel, log, input, sendBtn, toggleBtn;
  let open = false;
  let mounted = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = 'mascot-ui ' + (cls || '');
    if (text != null) e.textContent = text;
    return e;
  }

  function build() {
    // Bouton flottant pour ouvrir/fermer le chat
    toggleBtn = el('button', '');
    toggleBtn.id = 'mascot-chat-toggle';
    toggleBtn.textContent = '💬';
    toggleBtn.title = 'Discuter avec la mascotte';
    toggleBtn.addEventListener('click', toggle);

    // Panneau
    panel = el('div', '');
    panel.id = 'mascot-chat';

    const header = el('div', '');
    header.id = 'mascot-chat-header';
    const title = el('span', '', 'Pixel');
    const close = el('button', '', '✕');
    close.id = 'mascot-chat-close';
    close.title = 'Fermer';
    close.addEventListener('click', () => setOpen(false));
    header.appendChild(title);
    header.appendChild(close);

    log = el('div', '');
    log.id = 'mascot-chat-log';

    const inputRow = el('div', '');
    inputRow.id = 'mascot-chat-input-row';
    input = document.createElement('input');
    input.className = 'mascot-ui';
    input.id = 'mascot-chat-input';
    input.type = 'text';
    input.placeholder = 'Donne une instruction…';
    input.autocomplete = 'off';
    sendBtn = el('button', '', '➤');
    sendBtn.id = 'mascot-chat-send';
    sendBtn.title = 'Envoyer';

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(log);
    panel.appendChild(inputRow);

    // Événements d'envoi
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addUserMessage(text);
      if (onSendCb) onSendCb(text);
    };
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      e.stopPropagation(); // évite que la page n'intercepte la frappe
    });
  }

  function mount() {
    if (mounted) return;
    if (!panel) build();
    document.documentElement.appendChild(toggleBtn);
    document.documentElement.appendChild(panel);
    mounted = true;
    addMascotMessage('Coucou ! Écris-moi ce que tu veux que je fasse sur cette page.');
  }

  function unmount() {
    if (!mounted) return;
    toggleBtn.remove();
    panel.remove();
    mounted = false;
    open = false;
  }

  function setOpen(v) {
    open = v;
    panel.classList.toggle('open', v);
    toggleBtn.classList.toggle('hidden', v);
    if (v) setTimeout(() => input && input.focus(), 50);
  }
  function toggle() { setOpen(!open); }

  function appendBubble(text, who) {
    if (!log) return;
    const row = el('div', 'mascot-chat-msg ' + who);
    const b = el('div', 'mascot-chat-bubble');
    b.textContent = text;
    row.appendChild(b);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function addUserMessage(text) { appendBubble(text, 'user'); }

  let lastMascot = '';
  function addMascotMessage(text) {
    if (!text || text === lastMascot) return; // évite les doublons immédiats
    lastMascot = text;
    appendBubble(text, 'bot');
  }

  function setTyping(on) {
    if (!log) return;
    let t = log.querySelector('#mascot-chat-typing');
    if (on && !t) {
      t = el('div', 'mascot-chat-msg bot');
      t.id = 'mascot-chat-typing';
      const b = el('div', 'mascot-chat-bubble');
      b.textContent = '…';
      t.appendChild(b);
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
    } else if (!on && t) {
      t.remove();
    }
  }

  window.MascotChat = {
    init(opts) { onSendCb = opts && opts.onSend; },
    mount,
    unmount,
    open: () => setOpen(true),
    addMascotMessage,
    setTyping,
    isMounted: () => mounted
  };
})();
