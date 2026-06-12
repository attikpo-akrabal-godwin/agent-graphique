/**
 * Orchestrateur : boucle d'animation, comportements, bulle, drag, voix, messages.
 * Dépend de MascotPhysics, MascotSprite, MascotVoice (chargés avant).
 */
(() => {
  'use strict';
  if (window.top !== window) return; // pas dans les iframes
  if (window.__mascotLoaded) return;
  window.__mascotLoaded = true;

  const Physics = window.MascotPhysics;
  const Sprite = window.MascotSprite;
  const Voice = window.MascotVoice;

  // ---------- État ----------
  const body = {
    x: Math.min(140, innerWidth * 0.2),
    y: 0, vx: 0, vy: 0,
    grounded: false, platform: null, justLanded: false
  };

  const state = {
    enabled: true,
    wander: true,
    behavior: 'fall',        // fall | idle | walk | jump | drag
    facing: 1,
    walkPhase: 0,
    emotion: 'idle',
    emotionUntil: 0,
    blink: 0,
    nextBlink: performance.now() + 2000,
    squash: 0,
    walkTargetX: null,
    nextWanderAt: performance.now() + 3500,
    busy: false,            // séquence agentique en cours
    walkResolve: null,
    jumpResolve: null,
    dragOffX: 0, dragOffY: 0,
    lastMouse: { x: 0, y: 0, t: 0 },
    mouseVel: { x: 0, y: 0 }
  };

  const PHRASES = {
    greet: ['Coucou, je suis Pixel !', 'Me voilà !', 'Salut !'],
    land: ['Ouf !', 'Atterrissage réussi !', 'Hop !'],
    poke: ['Hé, ça chatouille !', 'Oui ?', 'Tu veux me parler ? Garde le micro appuyé !', 'Je regarde la page, elle est intéressante !'],
    fallOff: ['Wooo !', 'Aaah !'],
    pageComment: (title) => `On est sur « ${(title || 'cette page').slice(0, 60)} ».`
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- DOM ----------
  const canvas = document.createElement('canvas');
  canvas.id = 'mascot-canvas';
  canvas.className = 'mascot-ui';
  const ctx = canvas.getContext('2d');

  const hitbox = document.createElement('div');
  hitbox.id = 'mascot-hitbox';
  hitbox.className = 'mascot-ui';

  const mic = document.createElement('button');
  mic.id = 'mascot-mic';
  mic.textContent = '🎤';
  mic.title = 'Maintenir pour parler';
  if (!Voice.supported.stt) mic.style.display = 'none';
  hitbox.appendChild(mic);

  const bubble = document.createElement('div');
  bubble.id = 'mascot-bubble';
  bubble.className = 'mascot-ui';

  function mount() {
    document.documentElement.appendChild(canvas);
    document.documentElement.appendChild(hitbox);
    document.documentElement.appendChild(bubble);
  }
  function unmount() {
    canvas.remove(); hitbox.remove(); bubble.remove();
    Voice.stop();
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- Bulle + parole ----------
  let bubbleTimer = null;
  function say(text, { emotion = 'talking', mute = false, sticky = false } = {}) {
    return new Promise((resolve) => {
      bubble.textContent = text;
      bubble.classList.add('show');
      bubble.classList.remove('listening-style');
      setEmotion(emotion, 6000);
      clearTimeout(bubbleTimer);
      const hide = () => {
        bubble.classList.remove('show');
        if (state.emotion === 'talking') setEmotion('idle', 0);
      };
      if (mute || !Voice.supported.tts) {
        const ms = Math.max(2500, text.length * 60);
        if (!sticky) bubbleTimer = setTimeout(hide, ms);
        setTimeout(resolve, ms);
      } else {
        Voice.speak(text, {
          onend: () => {
            if (!sticky) bubbleTimer = setTimeout(hide, 800);
            resolve();
          }
        });
      }
    });
  }

  function setEmotion(emotion, durationMs) {
    state.emotion = emotion;
    state.emotionUntil = durationMs > 0 ? performance.now() + durationMs : Infinity;
    if (emotion === 'idle') state.emotionUntil = Infinity;
  }

  // ---------- Comportements ----------
  function startWalkTo(targetX) {
    state.behavior = 'walk';
    state.walkTargetX = targetX;
    state.facing = targetX > body.x ? 1 : -1;
  }

  function tryJumpTo(platform) {
    const targetX = platform.left + platform.width * (0.25 + Math.random() * 0.5);
    const v = Physics.jumpVelocity(body, targetX, platform.top);
    if (!v) return false;
    body.vx = v.vx;
    body.vy = v.vy;
    body.grounded = false;
    body.platform = null;
    state.behavior = 'jump';
    state.facing = v.vx >= 0 ? 1 : -1;
    return true;
  }

  function wanderTick(now) {
    if (!state.wander || state.busy || state.behavior === 'drag' || Voice.isListening()) return;
    if (now < state.nextWanderAt) return;
    state.nextWanderAt = now + 3000 + Math.random() * 6000;
    if (!body.grounded) return;

    const roll = Math.random();
    if (roll < 0.40) {
      // petite marche sur la plateforme courante
      const p = body.platform;
      if (p && p.width > 80) {
        const margin = 20;
        startWalkTo(p.left + margin + Math.random() * (p.width - margin * 2));
      }
    } else if (roll < 0.75) {
      const target = Physics.randomPlatform(body);
      if (target) tryJumpTo(target);
    } else if (roll < 0.85) {
      setEmotion(pick(['happy', 'thinking', 'surprised']), 2500);
    }
    // sinon : il ne fait rien, c'est aussi ça la vie
  }

  // ---------- Boucle principale ----------
  let lastT = performance.now();
  let rafId = null;

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    // Émotion expirée → idle
    if (now > state.emotionUntil) setEmotion('idle', 0);

    // Clignement
    if (now > state.nextBlink) {
      state.blink = 1;
      state.nextBlink = now + 1800 + Math.random() * 3500;
    }
    state.blink = Math.max(0, state.blink - dt * 8);

    // Comportements
    if (state.behavior === 'walk' && body.grounded) {
      const dx = state.walkTargetX - body.x;
      if (Math.abs(dx) < 6) {
        body.vx = 0;
        state.behavior = 'idle';
        if (state.walkResolve) { state.walkResolve(true); state.walkResolve = null; }
      } else {
        body.vx = Math.sign(dx) * 130;
        state.facing = Math.sign(dx) || 1;
        state.walkPhase += dt * 14;
      }
    } else if (state.behavior === 'idle') {
      body.vx = 0;
    }

    // Physique (sauf pendant le drag)
    if (state.behavior !== 'drag') {
      const wasGrounded = body.grounded;
      Physics.step(body, dt);
      if (body.justLanded) {
        state.squash = 1;
        if (state.behavior === 'jump' || state.behavior === 'fall') state.behavior = 'idle';
        if (state.jumpResolve) { state.jumpResolve(true); state.jumpResolve = null; }
        if (!wasGrounded && !state.busy && Math.random() < 0.25 && !Voice.isSpeaking()) {
          say(pick(PHRASES.land), { emotion: 'happy' });
        }
      }
      if (!body.grounded && state.behavior !== 'jump') state.behavior = 'fall';
    }
    state.squash = Math.max(0, state.squash - dt * 4);

    wanderTick(now);

    // Rendu
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const mouthAmp = Voice.mouthAmp(now);
    Sprite.draw(ctx, {
      x: body.x, y: body.y,
      facing: state.facing,
      grounded: body.grounded,
      vy: body.vy,
      walkPhase: state.walkPhase,
      emotion: Voice.isSpeaking() ? 'talking' : state.emotion,
      mouthAmp,
      blink: state.blink,
      squash: state.squash,
      t: now
    });

    // Positionne hitbox + bulle
    hitbox.style.left = (body.x - 28) + 'px';
    hitbox.style.top = (body.y - Sprite.HEIGHT) + 'px';
    const bx = Math.max(8, Math.min(innerWidth - 250, body.x + 20));
    const by = Math.max(8, body.y - Sprite.HEIGHT - bubble.offsetHeight - 10);
    bubble.style.left = bx + 'px';
    bubble.style.top = by + 'px';
  }

  // ---------- Drag & lancer ----------
  let dragMoved = false;
  hitbox.addEventListener('mousedown', (e) => {
    if (e.target === mic) return;
    e.preventDefault();
    state.behavior = 'drag';
    dragMoved = false;
    hitbox.classList.add('dragging');
    state.dragOffX = body.x - e.clientX;
    state.dragOffY = body.y - e.clientY;
    state.lastMouse = { x: e.clientX, y: e.clientY, t: performance.now() };
    setEmotion('surprised', 9999999);

    const onMove = (ev) => {
      dragMoved = true;
      const t = performance.now();
      const dtm = Math.max(t - state.lastMouse.t, 1) / 1000;
      state.mouseVel = {
        x: (ev.clientX - state.lastMouse.x) / dtm,
        y: (ev.clientY - state.lastMouse.y) / dtm
      };
      state.lastMouse = { x: ev.clientX, y: ev.clientY, t };
      body.x = ev.clientX + state.dragOffX;
      body.y = ev.clientY + state.dragOffY;
      body.grounded = false;
      body.platform = null;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hitbox.classList.remove('dragging');
      if (dragMoved) {
        // lancer !
        body.vx = Math.max(-800, Math.min(800, state.mouseVel.x * 0.6));
        body.vy = Math.max(-1200, Math.min(800, state.mouseVel.y * 0.6));
        state.behavior = 'fall';
        if (Math.abs(body.vy) > 300 && !Voice.isSpeaking()) say(pick(PHRASES.fallOff), { emotion: 'surprised' });
        else setEmotion('idle', 0);
      } else {
        // simple clic → il réagit
        state.behavior = 'fall';
        say(pick(PHRASES.poke), { emotion: 'happy' });
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ---------- Push-to-talk ----------
  function startListening() {
    if (!Voice.supported.stt || Voice.isListening()) return;
    Voice.stop(); // coupe la parole en cours
    bubble.textContent = 'Je t’écoute…';
    bubble.classList.add('show', 'listening-style');
    setEmotion('thinking', 9999999);
    Voice.listen({
      onPartial: (txt) => { bubble.textContent = '« ' + txt + ' »'; },
      onResult: (txt) => handleUserIntent(txt),
      onStateChange: (on) => {
        mic.classList.toggle('listening', on);
        if (!on) {
          bubble.classList.remove('listening-style');
          if (state.emotion === 'thinking') setEmotion('idle', 0);
          if (bubble.textContent.startsWith('Je t’écoute')) bubble.classList.remove('show');
        }
      }
    });
  }
  mic.addEventListener('mousedown', (e) => { e.stopPropagation(); startListening(); });
  mic.addEventListener('mouseup', () => Voice.stopListening());
  mic.addEventListener('mouseleave', () => Voice.stopListening());

  function handleUserIntent(text) {
    setEmotion('thinking', 9999999);
    bubble.textContent = '…';
    bubble.classList.add('show');
    const snapshot = window.MascotPerception ? window.MascotPerception.snapshot(body) : null;
    try {
      chrome.runtime.sendMessage(
        { type: 'USER_INTENT', text, snapshot, pageTitle: document.title, url: location.href },
        (res) => {
          if (chrome.runtime.lastError || !res) {
            say('Oups, je n’ai pas pu réfléchir. Réessaie ?', { emotion: 'sad' });
            return;
          }
          if (Array.isArray(res.steps) && window.MascotActions) {
            window.MascotActions.run(res.steps);
          } else if (res.reply) {
            say(res.reply, { emotion: res.emotion || 'talking' });
          }
        }
      );
    } catch (_) {
      say('Mon cerveau est déconnecté !', { emotion: 'sad' });
    }
  }

  // ---------- Reconstruction du niveau ----------
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => Physics.markDirty(), 300);
  });

  addEventListener('scroll', () => Physics.markDirty(), { passive: true });
  addEventListener('resize', () => { resizeCanvas(); Physics.markDirty(); });

  // ---------- Réglages + messages popup ----------
  function applySettings(s) {
    if (!s) return;
    Voice.configure(s);
    state.wander = s.wander !== false;
    if (s.enabled === false && state.enabled) {
      state.enabled = false;
      stopAll();
    } else if (s.enabled !== false && !state.enabled) {
      state.enabled = true;
      startAll();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const s = {};
    for (const k in changes) s[k] = changes[k].newValue;
    applySettings(Object.assign({ enabled: state.enabled, wander: state.wander }, s));
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'SPEAK' && state.enabled) {
      say(msg.text, { emotion: msg.emotion || 'talking' });
      sendResponse({ ok: true });
    }
    if (msg && msg.type === 'PING') sendResponse({ ok: true, enabled: state.enabled });
    return false;
  });

  // ---------- Démarrage / arrêt ----------
  function startAll() {
    mount();
    resizeCanvas();
    Physics.markDirty();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
    setTimeout(() => {
      if (!Voice.isSpeaking()) say(pick(PHRASES.greet), { emotion: 'happy' });
    }, 1200);
  }

  function stopAll() {
    cancelAnimationFrame(rafId);
    observer.disconnect();
    unmount();
  }

  // ---------- Branchement de l'exécuteur agentique ----------
  if (window.MascotActions) {
    window.MascotActions.init({
      say,
      setEmotion,
      getBody: () => body,
      setBusy: (v) => { state.busy = v; },
      walkTo: (x) => new Promise((resolve) => {
        if (state.walkResolve) { state.walkResolve(false); }
        state.walkResolve = resolve;
        startWalkTo(x);
        setTimeout(() => {
          if (state.walkResolve === resolve) { state.walkResolve = null; resolve(false); }
        }, 6000);
      }),
      jumpToRect: (rect) => new Promise((resolve) => {
        const platform = { el: null, left: rect.left, top: rect.top, right: rect.right, width: rect.width };
        if (!tryJumpTo(platform)) { resolve(false); return; }
        if (state.jumpResolve) state.jumpResolve(false);
        state.jumpResolve = resolve;
        setTimeout(() => {
          if (state.jumpResolve === resolve) { state.jumpResolve = null; resolve(body.grounded); }
        }, 3500);
      })
    });
  }

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
    if (chrome.runtime.lastError) s = null;
    if (s) {
      Voice.configure(s);
      state.wander = s.wander !== false;
      state.enabled = s.enabled !== false;
    }
    if (state.enabled) startAll();
  });
})();
