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
 *   open   — ouvrir des liens / naviguer
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
    switch (step.action) {
      case 'read-element': return 'read';
      case 'scroll-to':
      case 'scroll-by': return 'scroll';
      case 'navigate': return 'open';
      case 'select-option':
      case 'press-key': return 'fill';
      case 'set-checkbox': return 'click';
      case 'submit-form': return 'submit';
      case 'hover':
      case 'go-back':
      case 'go-forward':
      case 'wait': return null; // gestes peu sensibles : pas de confirmation
      case 'interact-element':
        if (step.kind === 'type') return 'fill';
        if (el) {
          if (el.type === 'submit' || (el.tagName === 'BUTTON' && el.closest('form') && el.type !== 'button')) return 'submit';
          if (el.tagName === 'A') return 'open';
        }
        return 'click';
      default: return null;
    }
  }

  const CONFIRM_TEXT = {
    click: (l) => `Je vais cliquer sur « ${l} » — ok ?`,
    fill: (l) => `Je vais écrire dans « ${l} » — ok ?`,
    submit: (l) => `Je vais soumettre via « ${l} » — ok ?`,
    open: (l) => `Je vais naviguer vers « ${l} » — ok ?`,
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

  function fireHover(el) {
    for (const type of ['pointerover', 'mouseover', 'mouseenter', 'mousemove']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function dispatchKey(el, key) {
    const opts = { bubbles: true, cancelable: true, key, code: key };
    const tgt = el || document.activeElement || document.body;
    if (tgt.focus) tgt.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      tgt.dispatchEvent(new KeyboardEvent(type, opts));
    }
  }

  function selectOption(el, step) {
    if (el.tagName !== 'SELECT') return;
    const wanted = String(step.value != null ? step.value : step.text || '');
    let opt = Array.from(el.options).find((o) => o.value === wanted);
    if (!opt) opt = Array.from(el.options).find((o) => (o.textContent || '').trim() === wanted);
    if (!opt) opt = Array.from(el.options).find((o) => (o.textContent || '').toLowerCase().includes(wanted.toLowerCase()));
    if (opt) { el.value = opt.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
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

      case 'scroll-by': {
        if (!(await ensureAllowed(step, null, 'la page'))) throw new Error('refused');
        const dy = Number(step.dy) || 500;
        window.scrollBy({ top: dy, behavior: 'smooth' });
        await wait(700);
        window.MascotPhysics.markDirty();
        break;
      }

      case 'hover':
        if (!el) break;
        await moveTo(el, step, { jump: true });
        fireHover(el);
        await wait(400);
        window.MascotPhysics.markDirty();
        break;

      case 'navigate': {
        const url = String(step.url || '');
        if (!/^https?:\/\//i.test(url)) break;
        if (!(await ensureAllowed(step, null, url.slice(0, 60)))) throw new Error('refused');
        await hooks.say('J’y vais !', { emotion: 'happy' });
        location.assign(url); // recharge la page (le content script se réinjecte)
        break;
      }

      case 'go-back':
        await hooks.say('Je reviens en arrière.', { emotion: 'talking' });
        history.back();
        break;

      case 'go-forward':
        history.forward();
        break;

      case 'select-option':
        if (!el) break;
        if (!(await ensureAllowed(step, el, label))) throw new Error('refused');
        await moveTo(el, step, { jump: true });
        selectOption(el, step);
        window.MascotPhysics.markDirty();
        await wait(300);
        break;

      case 'set-checkbox': {
        if (!el) break;
        if (!(await ensureAllowed(step, el, label))) throw new Error('refused');
        await moveTo(el, step, { jump: true });
        const want = step.checked !== false;
        if (!!el.checked !== want) el.click();
        await wait(250);
        break;
      }

      case 'press-key':
        if (!(await ensureAllowed(step, el, label || 'cet élément'))) throw new Error('refused');
        if (el) await moveTo(el, step, { jump: true });
        dispatchKey(el, step.key || 'Enter');
        window.MascotPhysics.markDirty();
        await wait(300);
        break;

      case 'submit-form': {
        if (!el) break;
        if (!(await ensureAllowed(step, el, label))) throw new Error('refused');
        await moveTo(el, step, { jump: true });
        const form = el.form || (el.closest && el.closest('form'));
        if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
        else el.click();
        await wait(400);
        break;
      }

      case 'wait':
        await wait(Math.min(Math.max(Number(step.ms) || 500, 0), 5000));
        break;

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
