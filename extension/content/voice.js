/**
 * Voix — synthèse (SpeechSynthesis) + reconnaissance (SpeechRecognition).
 * La synthèse pilote l'amplitude de bouche du sprite : pas d'accès direct au
 * volume, donc on estime via les événements `boundary` + une oscillation
 * pseudo-aléatoire pendant que ça parle (technique standard des avatars web).
 */
window.MascotVoice = (() => {
  'use strict';

  const settings = { lang: 'fr-FR', rate: 1.0, pitch: 1.05, voiceURI: '' };

  let speaking = false;
  let boundaryPulse = 0;   // pic à chaque frontière de mot
  let currentUtterance = null;

  const hasTTS = 'speechSynthesis' in window;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSTT = !!SR;

  function configure(s) {
    if (!s) return;
    if (s.lang) settings.lang = s.lang;
    if (typeof s.rate === 'number') settings.rate = s.rate;
    if (typeof s.pitch === 'number') settings.pitch = s.pitch;
    if (typeof s.voiceURI === 'string') settings.voiceURI = s.voiceURI;
  }

  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    return (
      voices.find((v) => v.voiceURI === settings.voiceURI) ||
      voices.find((v) => v.lang.replace('_', '-').startsWith(settings.lang.slice(0, 2))) ||
      voices[0] || null
    );
  }

  function speak(text, { onstart, onend } = {}) {
    if (!hasTTS || !text) { if (onend) onend(); return; }
    stop();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = settings.lang;
    u.rate = settings.rate;
    u.pitch = settings.pitch;
    u.onstart = () => { speaking = true; if (onstart) onstart(); };
    const done = () => {
      speaking = false;
      boundaryPulse = 0;
      currentUtterance = null;
      if (onend) onend();
    };
    u.onend = done;
    u.onerror = done;
    u.onboundary = () => { boundaryPulse = 1; };
    currentUtterance = u;
    speechSynthesis.speak(u);
  }

  function stop() {
    if (hasTTS) speechSynthesis.cancel();
    speaking = false;
    boundaryPulse = 0;
    currentUtterance = null;
  }

  /**
   * Amplitude de bouche 0..1 pour la frame courante.
   * t = timestamp ms (performance.now()).
   */
  function mouthAmp(t) {
    if (!speaking) {
      boundaryPulse *= 0.82; // la bouche se referme en douceur
      return boundaryPulse;
    }
    boundaryPulse *= 0.94;
    // double sinus désynchronisé → mouvement de parole crédible
    const osc = Math.abs(Math.sin(t * 0.016) * Math.sin(t * 0.009 + 1.7));
    return Math.min(1, 0.25 + 0.6 * osc + 0.4 * boundaryPulse);
  }

  // ---------- Reconnaissance vocale (push-to-talk) ----------
  let recognition = null;
  let listening = false;

  function listen({ onResult, onPartial, onStateChange } = {}) {
    if (!hasSTT || listening) return false;
    recognition = new SR();
    recognition.lang = settings.lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => { listening = true; if (onStateChange) onStateChange(true); };
    recognition.onresult = (e) => {
      let finalText = '', interim = '';
      for (const res of e.results) {
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim && onPartial) onPartial(interim);
      if (finalText && onResult) onResult(finalText.trim());
    };
    const stopState = () => { listening = false; if (onStateChange) onStateChange(false); };
    recognition.onend = stopState;
    recognition.onerror = stopState;
    try { recognition.start(); } catch (_) { stopState(); return false; }
    return true;
  }

  function stopListening() {
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) { /* déjà arrêté */ }
    }
  }

  // Certains navigateurs chargent les voix en différé.
  if (hasTTS && speechSynthesis.onvoiceschanged === null) {
    speechSynthesis.onvoiceschanged = () => {};
  }

  return {
    configure, speak, stop, mouthAmp,
    listen, stopListening,
    isSpeaking: () => speaking,
    isListening: () => listening,
    supported: { tts: hasTTS, stt: hasSTT }
  };
})();
