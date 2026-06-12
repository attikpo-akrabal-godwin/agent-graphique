/**
 * Moteur physique DOM — la page est le niveau.
 * Les éléments HTML visibles deviennent des plateformes solides (bord supérieur).
 * Coordonnées : viewport (les rects de getBoundingClientRect sont déjà en viewport,
 * et le canvas est en position fixed — tout est cohérent).
 */
window.MascotPhysics = (() => {
  'use strict';

  const GRAVITY = 2600;     // px/s²
  const MAX_FALL = 1600;    // vitesse de chute max
  const EDGE_TOL = 6;       // tolérance horizontale pour rester sur un bord
  const MIN_W = 36;         // taille minimale d'une plateforme
  const MIN_H = 8;
  const MAX_PLATFORMS = 250;

  const PLATFORM_SELECTOR = [
    'button', 'a', 'input', 'select', 'textarea', 'img', 'video',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th',
    'pre', 'blockquote', 'label', 'summary', 'figure', 'hr',
    'table', 'form', 'nav', 'header', 'footer', '[data-mascot-platform]'
  ].join(',');

  let platforms = [];
  let dirty = true;

  function markDirty() { dirty = true; }

  function isUsable(el, r) {
    if (r.width < MIN_W || r.height < MIN_H) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    if (r.top < 0) return false; // bord supérieur hors écran : pas posable
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) return false;
    if (cs.position === 'fixed' && el.closest('.mascot-ui')) return false;
    return true;
  }

  function collect() {
    const found = [];
    const els = document.querySelectorAll(PLATFORM_SELECTOR);
    for (const el of els) {
      if (el.closest('.mascot-ui')) continue;
      const r = el.getBoundingClientRect();
      if (!isUsable(el, r)) continue;
      found.push({ el, left: r.left, top: r.top, right: r.right, width: r.width });
      if (found.length >= MAX_PLATFORMS) break;
    }
    // Sol implicite : le bas de la fenêtre, infini horizontalement.
    found.push({ el: null, ground: true, left: -1e5, top: innerHeight - 4, right: 1e5, width: 2e5 });
    platforms = found;
    dirty = false;
  }

  /** Re-mesure une plateforme (l'élément a pu bouger ou disparaître). */
  function refresh(p) {
    if (p.ground) return { el: null, ground: true, left: -1e5, top: innerHeight - 4, right: 1e5, width: 2e5 };
    const el = p.el;
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!isUsable(el, r)) return null;
    return { el, left: r.left, top: r.top, right: r.right, width: r.width };
  }

  /** Cherche la plateforme la plus haute traversée entre prevY et b.y (pieds). */
  function findLanding(b, prevY) {
    let best = null;
    for (const p of platforms) {
      if (p.top < prevY - 2 || p.top > b.y + 1) continue;
      if (b.x < p.left - EDGE_TOL || b.x > p.right + EDGE_TOL) continue;
      if (!best || p.top < best.top) best = p;
    }
    return best;
  }

  /**
   * Avance la simulation d'un corps.
   * b = { x, y (pieds), vx, vy, grounded, platform, justLanded }
   */
  function step(b, dt) {
    if (dirty) collect();
    b.justLanded = false;

    // Vérifie que la plateforme sous les pieds existe toujours.
    if (b.grounded) {
      const p = b.platform ? refresh(b.platform) : null;
      if (!p) {
        b.grounded = false;
        b.platform = null;
      } else {
        b.platform = p;
        b.y = p.top;
        // Tombé du bord ?
        if (b.x < p.left - EDGE_TOL || b.x > p.right + EDGE_TOL) {
          b.grounded = false;
          b.platform = null;
        }
      }
    }

    if (b.grounded) {
      b.x += b.vx * dt;
      // Glisse légère sur le bord avant de tomber (effet dessin animé)
    } else {
      const prevY = b.y;
      b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
      b.y += b.vy * dt;
      b.x += b.vx * dt;
      if (b.vy > 0) {
        const hit = findLanding(b, prevY);
        if (hit) {
          b.y = hit.top;
          b.vy = 0;
          b.vx = 0;
          b.grounded = true;
          b.platform = hit;
          b.justLanded = true;
        }
      }
      // Plafond viewport : on rebondit mollement
      if (b.y < 10 && b.vy < 0) { b.y = 10; b.vy = 0; }
    }

    // Bords horizontaux du viewport
    if (b.x < 10) { b.x = 10; if (b.vx < 0) b.vx = 0; }
    if (b.x > innerWidth - 10) { b.x = innerWidth - 10; if (b.vx > 0) b.vx = 0; }

    // Filet de sécurité : jamais sous le sol
    if (b.y > innerHeight) { b.y = innerHeight - 4; b.vy = 0; b.grounded = true; b.platform = platforms[platforms.length - 1]; }
  }

  /**
   * Calcule les vélocités d'un saut parabolique vers (targetX, targetTop).
   * Retourne { vx, vy } ou null si hors de portée.
   */
  function jumpVelocity(b, targetX, targetTop) {
    const dh = b.y - targetTop;                       // >0 si la cible est plus haut
    const apexMargin = 60;                            // dépasse la cible de 60px
    const rise = Math.max(dh, 0) + apexMargin;
    const vy = -Math.sqrt(2 * GRAVITY * rise);
    // y(t) = y0 + vy·t + ½g·t² ; y(t) = targetTop → ½g·t² + vy·t + (y0 - targetTop) = 0
    const a = 0.5 * GRAVITY, bq = vy, c = b.y - targetTop;
    const d = bq * bq - 4 * a * c;
    if (d < 0) return null;
    const t = (-bq + Math.sqrt(d)) / (2 * a);
    if (!isFinite(t) || t <= 0.05) return null;
    let vx = (targetX - b.x) / t;
    vx = Math.max(-700, Math.min(700, vx));
    return { vx, vy };
  }

  /** Choisit une plateforme accessible au hasard (pour la déambulation). */
  function randomPlatform(b) {
    const candidates = platforms.filter((p) => {
      if (p.ground) return false;
      if (p === b.platform) return false;
      if (p.width < 50) return false;
      const dx = Math.abs((p.left + p.right) / 2 - b.x);
      const dy = b.y - p.top; // >0 = plus haut que nous
      return dx < 500 && dy > -350 && dy < 320; // portée de saut raisonnable
    });
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function getPlatforms() { return platforms; }

  return { step, collect, markDirty, refresh, jumpVelocity, randomPlatform, getPlatforms, GRAVITY };
})();
