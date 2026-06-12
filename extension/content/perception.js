/**
 * Perception du DOM — la mascotte « voit » la page comme un environnement structuré.
 * snapshot() retourne un état compact (budget tokens) pour l'IA, et maintient
 * un registre id → élément pour que l'exécuteur retrouve les cibles.
 */
window.MascotPerception = (() => {
  'use strict';

  const INTERACTIVE_SELECTOR = [
    'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[contenteditable="true"]', 'summary'
  ].join(',');

  const MAX_ELEMENTS = 40;
  const MAX_ERRORS = 5;

  let registry = new Map();

  function isVisible(el, r) {
    if (r.width < 8 || r.height < 8) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) >= 0.1;
  }

  function labelOf(el) {
    const txt =
      el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.innerText ||
      el.value ||
      el.placeholder ||
      el.title ||
      el.alt ||
      el.name ||
      '';
    return String(txt).replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function describe(el, id, r) {
    const tag = el.tagName.toLowerCase();
    const d = {
      id,
      tag,
      text: labelOf(el),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    };
    if (tag === 'input') d.type = el.type || 'text';
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) d.editable = true;
    if (tag === 'a') d.href = (el.getAttribute('href') || '').slice(0, 80);
    if (el.disabled) d.disabled = true;
    if (el.getAttribute('aria-invalid') === 'true') d.invalid = true;
    return d;
  }

  function collectErrors() {
    const errors = [];
    const sel = '[role="alert"], .error, .alert-danger, .invalid-feedback, [aria-live="assertive"]';
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('.mascot-ui')) continue;
      const r = el.getBoundingClientRect();
      if (!isVisible(el, r)) continue;
      const text = el.innerText.replace(/\s+/g, ' ').trim().slice(0, 100);
      if (text) errors.push(text);
      if (errors.length >= MAX_ERRORS) break;
    }
    return errors;
  }

  function modalOpen() {
    const sel = 'dialog[open], [role="dialog"], [role="alertdialog"], .modal.show, .modal[style*="display: block"]';
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('.mascot-ui')) continue;
      const r = el.getBoundingClientRect();
      if (isVisible(el, r)) return true;
    }
    return false;
  }

  function isLoading() {
    const sel = '[aria-busy="true"], .spinner, .loading, .loader, progress:not([value])';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (isVisible(el, r)) return true;
    }
    return false;
  }

  /** body = corps physique de la mascotte (optionnel, pour sa position). */
  function snapshot(body) {
    registry = new Map();
    let nextId = 1;
    const elements = [];
    for (const el of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
      if (el.closest('.mascot-ui')) continue;
      const r = el.getBoundingClientRect();
      if (!isVisible(el, r)) continue;
      const id = nextId++;
      registry.set(id, el);
      elements.push(describe(el, id, r));
      if (elements.length >= MAX_ELEMENTS) break;
    }
    return {
      page: { title: document.title.slice(0, 80), url: location.href.slice(0, 120) },
      viewport: { w: innerWidth, h: innerHeight, scrollY: Math.round(scrollY) },
      mascot: body ? { x: Math.round(body.x), y: Math.round(body.y) } : null,
      elements,
      errors: collectErrors(),
      modalOpen: modalOpen(),
      loading: isLoading()
    };
  }

  /** Retrouve un élément par l'id du dernier snapshot. */
  function get(id) {
    const el = registry.get(Number(id));
    return el && el.isConnected ? el : null;
  }

  return { snapshot, get, labelOf };
})();
