/**
 * Sprite canvas procédural — « Pixel », petite créature ronde.
 * Tout est dessiné en code : pas d'images, donc zéro asset à charger.
 * draw(ctx, s) où s = {
 *   x, y          : position des pieds (viewport)
 *   facing        : -1 | 1
 *   grounded, vy  : état physique
 *   walkPhase     : radians, avance quand il marche
 *   emotion       : 'idle'|'happy'|'sad'|'thinking'|'surprised'|'talking'
 *   mouthAmp      : 0..1, ouverture de bouche (synchro voix)
 *   blink         : 0..1 (1 = yeux fermés)
 *   squash        : 0..1, impulsion d'atterrissage
 *   t             : temps ms (pour les micro-animations)
 * }
 */
window.MascotSprite = (() => {
  'use strict';

  const R = 22; // rayon du corps

  const PALETTE = {
    body1: '#7c6cff',
    body2: '#5a4fd0',
    belly: '#a99bff',
    outline: 'rgba(30,27,75,0.55)',
    eye: '#ffffff',
    pupil: '#1e1b4b',
    cheek: 'rgba(255,107,129,0.55)',
    foot: '#3d35a0',
    antenna: '#ffd166'
  };

  function draw(ctx, s) {
    const t = s.t || 0;
    ctx.save();
    ctx.translate(s.x, s.y);

    // --- Squash & stretch ---
    let sx = 1, sy = 1;
    if (!s.grounded) {
      const k = Math.min(Math.abs(s.vy) / 1400, 1) * 0.22;
      sy = 1 + k; sx = 1 - k * 0.7;
    } else if (s.squash > 0) {
      sy = 1 - s.squash * 0.35;
      sx = 1 + s.squash * 0.3;
    } else if (s.emotion === 'happy') {
      const b = Math.sin(t * 0.02) * 0.05;
      sy = 1 + b; sx = 1 - b;
    } else {
      // respiration idle
      const b = Math.sin(t * 0.004) * 0.02;
      sy = 1 + b; sx = 1 - b;
    }
    ctx.scale(s.facing * sx, sy); // miroir horizontal selon la direction

    const cy = -R - 6; // centre du corps au-dessus des pieds

    // --- Ombre ---
    ctx.save();
    ctx.scale(1 / sx, 1 / sy); // l'ombre (symétrique) ne se déforme pas
    ctx.globalAlpha = s.grounded ? 0.25 : 0.12;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 2, R * 0.9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- Pieds ---
    const step = s.walkPhase || 0;
    const lift = s.grounded ? 4 : 0;
    const f1 = Math.sin(step) * lift;
    const f2 = Math.sin(step + Math.PI) * lift;
    ctx.fillStyle = PALETTE.foot;
    ctx.beginPath();
    ctx.ellipse(-9, -4 - Math.max(f1, 0), 8, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(9, -4 - Math.max(f2, 0), 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Corps ---
    const grad = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    grad.addColorStop(0, PALETTE.body1);
    grad.addColorStop(1, PALETTE.body2);
    ctx.fillStyle = grad;
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, cy, R, R * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // ventre
    ctx.fillStyle = PALETTE.belly;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(0, cy + 7, R * 0.55, R * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // --- Antenne ---
    const sway = Math.sin(t * 0.005) * 3 + (s.grounded ? 0 : -s.vy * 0.004);
    ctx.strokeStyle = PALETTE.body2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, cy - R + 2);
    ctx.quadraticCurveTo(sway, cy - R - 8, sway * 1.5, cy - R - 14);
    ctx.stroke();
    ctx.fillStyle = PALETTE.antenna;
    ctx.beginPath();
    ctx.arc(sway * 1.5, cy - R - 16, 3.5 + Math.sin(t * 0.008) * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // --- Yeux ---
    const eyeY = cy - 4;
    const blink = Math.max(0, Math.min(1, s.blink || 0));
    const eyeH = 6 * (1 - blink);
    let pupilDX = 1.5, pupilDY = 0;
    if (s.emotion === 'thinking') { pupilDX = 2.5; pupilDY = -2.5; }
    if (s.emotion === 'sad') { pupilDY = 2; }
    const wide = s.emotion === 'surprised' ? 1.5 : 1;

    for (const side of [-1, 1]) {
      const ex = side * 8.5;
      ctx.fillStyle = PALETTE.eye;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 5.5 * wide, Math.max(eyeH * wide, 0.8), 0, 0, Math.PI * 2);
      ctx.fill();
      if (blink < 0.7) {
        ctx.fillStyle = PALETTE.pupil;
        ctx.beginPath();
        ctx.arc(ex + pupilDX, eyeY + pupilDY, 2.6 * wide, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(ex + pupilDX + 1, eyeY + pupilDY - 1, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      // sourcils selon émotion
      if (s.emotion === 'sad' || s.emotion === 'thinking') {
        ctx.strokeStyle = PALETTE.pupil;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const tilt = s.emotion === 'sad' ? side * 2 : -side * 1;
        ctx.moveTo(ex - 4, eyeY - 8 + tilt);
        ctx.lineTo(ex + 4, eyeY - 8 - tilt);
        ctx.stroke();
      }
    }

    // --- Joues ---
    if (s.emotion === 'happy' || s.emotion === 'talking') {
      ctx.fillStyle = PALETTE.cheek;
      ctx.beginPath();
      ctx.ellipse(-13, cy + 2, 3.5, 2.2, 0, 0, Math.PI * 2);
      ctx.ellipse(13, cy + 2, 3.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Bouche (synchronisée avec la voix) ---
    const my = cy + 6;
    const amp = Math.max(0, Math.min(1, s.mouthAmp || 0));
    ctx.fillStyle = PALETTE.pupil;
    ctx.strokeStyle = PALETTE.pupil;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (amp > 0.05) {
      // bouche ouverte : ellipse dont la hauteur suit l'amplitude
      ctx.ellipse(0, my + 1, 4.5 + amp * 2, 1.5 + amp * 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // langue
      if (amp > 0.45) {
        ctx.fillStyle = '#ff6b81';
        ctx.beginPath();
        ctx.ellipse(0, my + 2.5 + amp * 2, 2.5, 1.5 + amp * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s.emotion === 'happy') {
      ctx.beginPath(); ctx.arc(0, my - 1, 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    } else if (s.emotion === 'sad') {
      ctx.beginPath(); ctx.arc(0, my + 5, 5, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    } else if (s.emotion === 'surprised') {
      ctx.beginPath(); ctx.ellipse(0, my + 1, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (s.emotion === 'thinking') {
      ctx.beginPath(); ctx.moveTo(-4, my + 1); ctx.lineTo(3, my); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, my - 1, 4, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    }

    ctx.restore();

    // --- Indicateur "pense" (points au-dessus de la tête) ---
    if (s.emotion === 'thinking') {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 3; i++) {
        const a = (Math.sin(t * 0.006 + i * 0.9) + 1) / 2;
        ctx.globalAlpha = 0.3 + a * 0.7;
        ctx.beginPath();
        ctx.arc(s.x + 18 + i * 8, s.y - R * 2 - 22 - i * 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Hauteur approximative du sprite (pour positionner la bulle). */
  const HEIGHT = R * 2 + 24;
  const WIDTH = R * 2 + 8;

  return { draw, HEIGHT, WIDTH };
})();
