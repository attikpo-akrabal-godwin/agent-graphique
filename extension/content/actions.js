/**
 * Exécuteur de séquences d'actions agentiques + système de permissions.
 * L'IA retourne des étapes ordonnées ; chacune est jouée avec la physique
 * (la mascotte se déplace réellement) et les interactions sensibles passent
 * par une confirmation visuelle, sauf permission globale accordée pour le site.
 *
 * Permissions par site (chrome.storage.local, clé "perm:<origin>") :
 *   click  — cliquer sur des boutons
 *   fill   — remplir des champs
 *   submit — soumettre des formulaires
 *   open   — ouvrir des liens
 *   scroll — faire défiler la page
 *   read   — lire le contenu à voix haute
 */
window.MascotActions = (() => {
  'use strict';

  let hooks = null;       // fournis par main.js : say, setEmotion, walkTo, jumpToRect, getBody, setBusy
  let running = false;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Permissions ----------
  const permKey = () => 'perm:' + location.origin;

  function getPerms() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [permKey()]: {} }, (v) => resolve(v[permKey()] || {}));
      } catch (_) { resolve({}); }
    });
  }

  function categoryOf(step, el) {
    if (step.action === 'read-element') return 'read';
    if (step.action === 'scroll-to') return 'scroll';
    if (step.action !== 'interact-element') return null;
    if (step.kind === 'type') return 'fill';
    if (el) {
      if (el.type === 'submit' || (el.tagName === 'BUTTON' && el.closest('form') && el.type !== 'button')) return 'submit';
      if (el.tagName === 'A') return 'open';
    }
    return 'click';
  }

  const CONFIRM_TEXT = {
    click: (l) => `Je vais cliquer sur « ${l} » — ok ?`,
    fill: (l) => `Je vais écrire dans « ${l} » — ok ?`,
    submit: (l) => `Je vais soumettre via « ${l} » — ok ?`,
    open: (l) => `Je vais ouvrir le lien « ${l} » — ok ?`,
    scroll: () => `Je vais faire défiler la page — ok ?`,
    read: (l) => `Je te lis « ${l} » ?`
  };

  // ---------- UI de confirmation ----------
  let box = null;
  let pendingResolve = null;

  function buildConfirmUI() {
    box = document.createElement('div');
    box.id = 'mascot-confirm';
    box.className = 'mascot-ui';
    box.innerHTML =
      '<span id="mascot-confirm-text"></span>' +
      '<div class="mascot-confirm-btns">' +
      '<button id="mascot-confirm-yes">✓ Oui</button>' +
      '<button id="mascot-confirm-no">✗ Non</button>' +
      '</div>';
    document.documentElement.appendChild(box);
    box.querySelector('#mascot-confirm-yes').addEventListener('click', () => settle(true));
    box.querySelector('#mascot-confirm-no').addEventListener('click', () => settle(false));
  }

  function settle(value) {
    box.classList.remove('show');
    if (pendingResolve) { pendingResolve(value); pendingResolve = null; }
  }

  function askConfirm(text) {
    return new Promise((resolve) => {
      if (!box) buildConfirmUI();
      if (pendingResolve) pendingResolve(false); // une seule question à la fois
      pendingResolve = resolve;
      box.querySelector('#mascot-confirm-text').textContent = text;
      const b = hooks.getBody();
      box.style.left = Math.max(8, Math.min(innerWidth - 230, b.x - 60)) + 'px';
      box.style.top = Math.max(8, b.y - 150) + 'px';
      box.classList.add('show');
      hooks.setEmotion('thinking', 9999999);
      // expire après 15 s = refus
      setTimeout(() => { if (pendingResolve === resolve) settle(false); }, 15000);
    });
  }

  async function ensureAllowed(step, el, label) {
    const cat = categoryOf(step, el);
    if (!cat) return true;
    const perms = await getPerms();
    if (perms[cat]) return true; // permission globale pour ce site
    const ok = await askConfirm(CONFIRM_TEXT[cat](label || 'cet élément'));
    if (hooks) hooks.setEmotion(ok ? 'happy' : 'sad', 1500);
    return ok;
  }

  // ---------- Helpers ----------
  function rectOf(el, step) {
    if (el) {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, width: r.width, cx: r.left + r.width / 2 };
    }
    if (step && typeof step.x === 'number') return { cx: step.x, left: step.x - 20, right: step.x + 20, top: 0, width: 40 };
    return null;
  }

  function setNativeValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
  }

  function textOf(el) {
    const t = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 350) || 'Cet élément est vide.';
  }

  // ---------- Exécution ----------
  async function moveTo(el, step, { jump = false } = {}) {
    const r = rectOf(el, step);
    if (!r) return false;
    if (jump) {
      const ok = await hooks.jumpToRect(r);
      if (ok) return true;
    }
    return hooks.walkTo(r.cx);
  }

  async function exec(step) {
    const P = window.MascotPerception;
    const el = step.target != null ? P.get(step.target) : null;
    const label = el ? P.labelOf(el) : '';

    switch (step.action) {
      case 'say':
        await hooks.say(String(step.text || '').slice(0, 400), { emotion: step.emotion || 'talking' });
        break;

      case 'emote':
        hooks.setEmotion(step.emotion || 'happy', step.duration || 2000);
        await wait(Math.min(step.duration || 1200, 4000));
        break;

      case 'walk-to-target':
        await moveTo(el, step);
        break;

      case 'jump-to-platform':
      case 'stand-on-element':
        await moveTo(el, step, { jump: true });
        break;

      case 'read-element':
        if (!el) break;
        if (!(await ensureAllowed(step, el, label))) throw new Error('refused');
        await moveTo(el, step, { jump: true });
        await hooks.say(textOf(el), { emotion: 'talking' });
        break;

      case 'scroll-to':
        if (!el) break;
        if (!(await ensureAllowed(step, el, label))) throw new Error('refused');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(900);
        window.MascotPhysics.markDirty();
        break;

      case 'interact-element': {
        if (!el) break;
        if (!(await ensureAllowed(step, el, label))) throw new Error('refused');
        await moveTo(el, step, { jump: true });
        hooks.setEmotion('happy', 2000);
        await wait(250); // petite anticipation avant le geste
        if (step.kind === 'type') {
          setNativeValue(el, String(step.text || ''));
        } else {
          el.click();
        }
        window.MascotPhysics.markDirty();
        await wait(400);
        break;
      }

      default:
        // étape inconnue : on l'ignore poliment
        break;
    }
  }

  async function run(steps) {
    if (!hooks || running || !Array.isArray(steps) || !steps.length) return;
    running = true;
    hooks.setBusy(true);
    try {
      for (const step of steps.slice(0, 12)) {
        await exec(step);
      }
    } catch (e) {
      if (e && e.message === 'refused') {
        await hooks.say("D'accord, j'annule !", { emotion: 'sad' });
      } else {
        console.error('[mascot] action error', e);
      }
    } finally {
      running = false;
      hooks.setBusy(false);
      hooks.setEmotion('idle', 0);
    }
  }

  function init(h) { hooks = h; }

  return { init, run, isRunning: () => running };
})();
