'use strict';
/* 꼬마놀이 — 만 2세용 오프라인 게임 10종 */
const $ = (s, r = document) => r.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const IMG = window.IMG || {}, SVG = window.SVGI || {}, SNDDATA = window.SND || {};
const src = n => IMG[n] || ('img/' + n + '.png');

/* ---------- settings ---------- */
const settings = Object.assign({ vol: 80, voice: true }, (() => { try { return JSON.parse(localStorage.getItem('kids-settings')) || {}; } catch (e) { return {}; } })());
const saveSettings = () => { try { localStorage.setItem('kids-settings', JSON.stringify(settings)); } catch (e) {} };

/* ---------- audio engine ---------- */
const Snd = {
  ctx: null, master: null, buf: {}, ready: false,
  create() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.vol / 100;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(this.ctx.destination);
  },
  async decodeAll(onprog) {
    this.create();
    const names = Object.keys(SNDDATA); let done = 0;
    await Promise.all(names.map(async n => {
      try {
        const bin = atob(SNDDATA[n]); const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        this.buf[n] = await new Promise((res, rej) => this.ctx.decodeAudioData(u8.buffer, res, rej));
      } catch (e) { console.warn('decode fail', n, e); }
      onprog && onprog(++done, names.length);
    }));
    this.ready = true;
  },
  unlock() {
    this.create();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (this.ctx.state !== 'running') this.ctx.resume();
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.master); s.start(0);
  },
  play(n, o = {}) {
    const b = this.buf[n]; if (!b || !this.ctx) return null;
    if (this.ctx.state !== 'running') this.ctx.resume();
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = b; s.playbackRate.value = o.rate || 1; g.gain.value = o.vol == null ? 1 : o.vol;
    s.connect(g); g.connect(this.master);
    const t = this.ctx.currentTime + (o.delay || 0);
    s.start(t);
    s._g = g;
    s.fade = (d = 0.3) => { try { g.gain.setTargetAtTime(0, this.ctx.currentTime, d / 3); s.stop(this.ctx.currentTime + d + 0.1); } catch (e) {} };
    if (o.loop) s.loop = true;
    return s;
  },
  dur(n) { return this.buf[n] ? this.buf[n].duration : 1; },
  setVol(v) { if (this.master) this.master.gain.setTargetAtTime(v / 100, this.ctx.currentTime, 0.05); }
};

/* ---------- speech (on-device Korean voice) ---------- */
const Voice = {
  v: null,
  init() {
    if (!('speechSynthesis' in window)) return;
    const choose = () => { const vs = speechSynthesis.getVoices(); this.v = vs.find(v => v.lang === 'ko-KR' && /yuna|유나/i.test(v.name)) || vs.find(v => /^ko/.test(v.lang)) || null; };
    choose(); speechSynthesis.onvoiceschanged = choose;
  },
  unlock() { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } },
  say(t, o = {}) {
    if (!settings.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t); u.lang = 'ko-KR'; if (this.v) u.voice = this.v;
      u.rate = o.rate || 0.9; u.pitch = o.pitch || 1.3; u.volume = Math.min(1, settings.vol / 100 + 0.1);
      speechSynthesis.speak(u);
    } catch (e) {}
  },
  stop() { try { speechSynthesis.cancel(); } catch (e) {} }
};

/* ---------- screen wake lock ---------- */
let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (Snd.ctx) Snd.ctx.resume(); } });

/* ---------- block system gestures ---------- */
['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('pointerdown', () => { if (Snd.ctx && Snd.ctx.state !== 'running') Snd.ctx.resume(); }, true);

/* ---------- scope: auto-cleanup of timers/listeners/sounds ---------- */
function Scope() {
  const fns = []; let alive = true;
  return {
    get alive() { return alive; },
    t(fn, ms) { const id = setTimeout(() => alive && fn(), ms); fns.push(() => clearTimeout(id)); return id; },
    iv(fn, ms) { const id = setInterval(() => alive && fn(), ms); fns.push(() => clearInterval(id)); return id; },
    raf(fn) { let id; const loop = ts => { if (!alive) return; fn(ts); id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); fns.push(() => cancelAnimationFrame(id)); },
    on(el, ev, fn, o) { el.addEventListener(ev, fn, o); fns.push(() => el.removeEventListener(ev, fn, o)); },
    snd(n, o) { const s = Snd.play(n, o); if (s) fns.push(() => s.fade(0.15)); return s; },
    add(fn) { fns.push(fn); },
    dispose() { alive = false; fns.splice(0).forEach(f => { try { f(); } catch (e) {} }); Voice.stop(); }
  };
}

/* ---------- DOM helpers ---------- */
function el(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
function im(n, parent, cls) { const i = el('img', cls, parent); i.src = src(n); i.draggable = false; i.alt = ''; return i; }
function center(e) { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
const anim = (e, kf, o) => e.animate(kf, Object.assign({ easing: 'ease-out', fill: 'forwards' }, typeof o === 'number' ? { duration: o } : o));
function boing(e, s = 1.18) { return anim(e, [{ transform: 'scale(1)' }, { transform: `scale(${s}) rotate(-6deg)` }, { transform: 'scale(.94) rotate(4deg)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 520, fill: 'none' }); }

/* particle bursts */
function burst(stage, x, y, o = {}) {
  const n = o.n || 10, imgs = o.imgs || ['star', 'sparkles'], size = o.size || 46, spread = o.spread || 160;
  for (let i = 0; i < n; i++) {
    let p;
    if (o.colors && Math.random() < 0.6) { p = el('div', 'dot', stage); const s = rand(10, 20); p.style.cssText = `width:${s}px;height:${s}px;background:${pick(o.colors)}`; }
    else { p = im(pick(imgs), stage, 'fx'); p.style.width = rand(size * .6, size) + 'px'; }
    const a = rand(0, Math.PI * 2), d = rand(spread * .4, spread);
    p.style.left = x + 'px'; p.style.top = y + 'px';
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d + (o.gravity ? 60 : 0);
    const r = rand(-180, 180);
    anim(p, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 }, { transform: `translate(calc(-50% + ${dx * .7}px),calc(-50% + ${dy * .6}px)) scale(1) rotate(${r / 2}deg)`, opacity: 1, offset: .5 }, { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.6) rotate(${r}deg)`, opacity: 0 }], { duration: rand(700, 1100), easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => p.remove();
  }
}
function floatUp(stage, x, y, n = 'musical-note', size = 50, hue = 0) {
  const p = im(n, stage, 'fx'); p.style.width = size + 'px'; p.style.left = x + 'px'; p.style.top = y + 'px';
  if (hue) p.style.filter = `hue-rotate(${hue}deg)`;
  const dx = rand(-40, 40);
  anim(p, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-90%) scale(1)', opacity: 1, offset: .2 }, { transform: `translate(calc(-50% + ${dx}px),-320%) scale(.9) rotate(${dx / 2}deg)`, opacity: 0 }], { duration: 1500, easing: 'ease-out' }).onfinish = () => p.remove();
}

/* ---------- hold-to-activate (parents) ---------- */
function holdButton(btn, ms, fn) {
  let t = null;
  const start = e => { e.preventDefault(); e.stopPropagation(); btn.classList.add('holding'); t = setTimeout(() => { btn.classList.remove('holding'); fn(); }, ms); };
  const end = () => { clearTimeout(t); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, end));
}

/* ======================================================================
   GAMES
   ====================================================================== */
const COLORS = ['#ff6b81', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'];
const NAMES = { 'dog-face': '강아지', 'cat-face': '고양이', 'cow-face': '소', 'pig-face': '돼지', bear: '곰', panda: '판다', lion: '사자', frog: '개구리', 'rabbit-face': '토끼', 'tiger-face': '호랑이', koala: '코알라', unicorn: '유니콘', 'monkey-face': '원숭이', penguin: '펭귄', hamster: '햄스터', 'baby-chick': '병아리', elephant: '코끼리', hippopotamus: '하마' };

const GAMES = [];

/* 1. 동물 소리판 */
GAMES.push({ id: 'animals', icon: 'dog-face', color: '#ffe3b3', start(st, S) {
  st.className = 'g-animals';
  const A = [['dog-face', 'dog', '강아지', '멍멍', '#ffe8cc'], ['cat-face', 'cat', '고양이', '야옹', '#fff3bf'], ['cow-face', 'cow', '소', '음메', '#e7f5ff'], ['pig-face', 'pig', '돼지', '꿀꿀', '#ffdeeb'],
    ['rooster', 'rooster', '닭', '꼬끼오', '#ffe3e3'], ['ewe', 'sheep', '양', '매에', '#f3f0ff'], ['frog', 'frog', '개구리', '개굴개굴', '#ebfbee'], ['bird', 'bird', '새', '짹짹', '#e3fafc']];
  const g = el('div', 'agrid', st); let cur = null, sayT = null;
  A.forEach(([img, snd, name, cry, bg]) => {
    const c = el('div', 'acard', g); c.style.background = bg; const i = im(img, c);
    S.on(c, 'pointerdown', () => {
      if (cur) cur.fade(0.12); cur = S.snd(snd);
      boing(i, 1.22); anim(c, [{ transform: 'scale(.95)' }, { transform: 'scale(1)' }], { duration: 300, fill: 'none' });
      const p = center(c); for (let k = 0; k < 2; k++) S.t(() => floatUp(st, p.x + rand(-p.w / 3, p.w / 3), p.y - p.h / 4, pick(['musical-note', 'musical-notes']), 44, rand(0, 300)), k * 220);
      clearTimeout(sayT); Voice.stop(); sayT = S.t(() => Voice.say(`${cry}! ${name}`), Snd.dur(snd) * 1000 + 80);
    });
  });
} });

/* 2. 풍선 터뜨리기 */
GAMES.push({ id: 'balloons', icon: 'balloon', color: '#d0ebff', start(st, S) {
  st.className = 'g-balloons';
  for (let i = 0; i < 3; i++) { const c = im('cloud', st, 'cloud'); c.style.cssText = `top:${8 + i * 17}%;width:${rand(18, 28)}vmin;animation-duration:${rand(40, 70)}s;animation-delay:-${rand(0, 40)}s`; }
  const HUES = [0, 30, 52, 110, 190, 250, 300]; let alive = 0, pops = 0;
  const W = () => st.clientWidth, H = () => st.clientHeight;
  function spawn(progress = 0) {
    if (alive >= 7) return; alive++;
    const size = Math.min(W(), H()) * rand(0.2, 0.26), b = el('div', 'balloon', st), sw = el('div', 'sw', b), hue = pick(HUES);
    b.style.width = size + 'px'; sw.style.animationDelay = -rand(0, 2) + 's'; const i = im('balloon', sw); i.style.filter = `hue-rotate(${hue}deg) saturate(1.15)`;
    const x = rand(0.04, 0.96) * W() - size / 2, dur = rand(7500, 10500);
    const a = anim(b, [{ transform: `translate(${x}px,${H() + 10}px)` }, { transform: `translate(${x + rand(-60, 60)}px,${-size * 1.6}px)` }], { duration: dur, easing: 'linear' });
    a.currentTime = dur * progress;
    let gone = false;
    a.onfinish = () => { if (!gone) { gone = true; alive--; b.remove(); } };
    S.on(b, 'pointerdown', e => {
      if (gone) return; gone = true; alive--; a.pause();
      const p = center(b); const col = `hsl(${(355 + hue) % 360},85%,60%)`;
      S.snd(pick(['pop1', 'pop2', 'pop3']), { rate: rand(0.92, 1.1) });
      b.remove(); burst(st, p.x, p.y - p.h * .15, { n: 14, colors: [col, '#fff', '#ffd43b'], imgs: ['star', 'sparkles'], size: 40, spread: size * .9 });
      if (++pops % 6 === 0) { S.t(() => { S.snd('yay'); for (let k = 0; k < 4; k++) S.t(() => burst(st, rand(.2, .8) * W(), rand(.2, .6) * H(), { n: 10, imgs: ['star', 'glowing-star', 'sparkles', 'red-heart'], size: 60, spread: 220 }), k * 180); }, 250); }
    });
  }
  [0.15, 0.4, 0.62].forEach(p => spawn(p));
  S.iv(() => spawn(), 1150);
} });

/* 3. 까꿍 숨바꼭질 */
GAMES.push({ id: 'peek', icon: 'wrapped-gift', color: '#ffe0e9', start(st, S) {
  st.className = 'g-peek';
  const POOL = ['bear', 'panda', 'rabbit-face', 'monkey-face', 'penguin', 'koala', 'tiger-face', 'hamster', 'lion', 'baby-chick', 'elephant', 'unicorn', 'dog-face', 'cat-face'];
  const HIDERS = [['cloud', { transform: 'translate(0,-75%) scale(1.1)', opacity: .4 }], ['wrapped-gift', { transform: 'translate(70%,10%) rotate(28deg)', opacity: .9 }], ['deciduous-tree', { transform: 'translate(-72%,0) rotate(-10deg)', opacity: .9 }]];
  const row = el('div', 'prow', st); const showing = new Set();
  HIDERS.forEach(([h, away]) => {
    const slot = el('div', 'slot', row), who = el('div', 'who', slot), wi = im('bear', who), hider = el('div', 'hider', slot); im(h, hider);
    if (h === 'cloud') { hider.style.alignItems = 'center'; slot.classList.add('sky'); who.style.bottom = '20%'; }
    let busy = false, animal;
    const choose = () => { do { animal = pick(POOL); } while (showing.has(animal)); wi.src = src(animal); };
    choose();
    S.on(slot, 'pointerdown', () => {
      if (busy) { boing(wi, 1.15); S.snd(pick(['twinkle1', 'twinkle2'])); return; }
      busy = true; showing.add(animal);
      anim(hider, [{ transform: 'none' }, away], { duration: 450, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      anim(who, [{ transform: 'translateY(40%) scale(.3)', opacity: 0 }, { transform: 'translateY(-12%) scale(1.12)', opacity: 1, offset: .65 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: 520, delay: 120 });
      S.snd('reveal'); S.t(() => Voice.say('까꿍!', { pitch: 1.45, rate: 1 }), 150);
      const p = center(slot); S.t(() => burst(st, p.x, p.y, { n: 9, imgs: ['sparkles', 'star', 'red-heart'], size: 44, spread: p.w * .6 }), 300);
      S.t(() => {
        anim(who, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(30%) scale(.4)', opacity: 0 }], { duration: 380, easing: 'ease-in' });
        anim(hider, [away, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.3,1.3,.5,1)' });
        S.snd('hide', { vol: .8 });
        S.t(() => { showing.delete(animal); choose(); busy = false; }, 500);
      }, 2800);
    });
  });
} });

/* 4. 반짝이 그림 */
GAMES.push({ id: 'draw', icon: 'artist-palette', color: '#e5dbff', start(st, S) {
  st.className = 'g-draw';
  const cv = el('canvas', '', st), ctx = cv.getContext('2d'); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => { cv.width = st.clientWidth * dpr; cv.height = st.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = ctx.lineJoin = 'round'; };
  fit(); S.on(window, 'resize', fit);
  const stamps = ['star', 'red-heart', 'yellow-heart', 'blue-heart', 'glowing-star', 'purple-heart', 'green-heart'].map(n => { const i = new Image(); i.src = src(n); return i; });
  const NOTES = ['mb_C5', 'mb_D5', 'mb_E5', 'mb_G5', 'mb_A5', 'mb_C6', 'mb_D6', 'mb_E6'];
  let hue = rand(0, 360); const P = new Map(); let lastNote = 0, fx = 0;
  S.on(cv, 'pointerdown', e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, dist: 0, acc: 0, moved: false }); });
  S.on(cv, 'pointermove', e => {
    const p = P.get(e.pointerId); if (!p) return;
    const x = e.clientX, y = e.clientY, d = Math.hypot(x - p.x, y - p.y); if (d < 2) return;
    hue = (hue + d * 0.35) % 360;
    ctx.shadowBlur = 22; ctx.shadowColor = `hsl(${hue},100%,65%)`; ctx.strokeStyle = `hsl(${hue},100%,68%)`; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x, y); ctx.stroke();
    p.dist += d; p.acc += d; p.x = x; p.y = y; if (Math.hypot(x - p.sx, y - p.sy) > 12) p.moved = true;
    if (p.acc > 55 && fx < 30) { p.acc = 0; fx++; const s = im(pick(['sparkles', 'star', 'glowing-star']), st, 'fx'); s.style.cssText += `left:${x}px;top:${y}px;width:${rand(26, 44)}px`;
      anim(s, [{ transform: 'translate(-50%,-50%) scale(.2) rotate(0)', opacity: 1 }, { transform: `translate(calc(-50% + ${rand(-30, 30)}px),calc(-50% + ${rand(-40, 10)}px)) scale(1) rotate(${rand(-90, 90)}deg)`, opacity: 0 }], { duration: 800 }).onfinish = () => { s.remove(); fx--; }; }
    const now = performance.now();
    if (now - lastNote > 140 && p.dist > 70) { p.dist = 0; lastNote = now; const idx = Math.max(0, Math.min(NOTES.length - 1, Math.floor((1 - y / st.clientHeight) * NOTES.length))); S.snd(NOTES[idx], { vol: .5 }); }
  });
  const up = e => {
    const p = P.get(e.pointerId); if (!p) return; P.delete(e.pointerId);
    if (!p.moved) { const img = pick(stamps), s = rand(80, 120); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rand(-.4, .4)); ctx.drawImage(img, -s / 2, -s / 2, s, s); ctx.restore(); S.snd(pick(['twinkle1', 'twinkle2', 'twinkle3', 'twinkle4'])); burst(st, p.x, p.y, { n: 6, imgs: ['sparkles'], size: 34, spread: 90 }); }
  };
  S.on(cv, 'pointerup', up); S.on(cv, 'pointercancel', up);
  const er = el('button', 'erase', st); im('bubbles', er);
  S.on(er, 'pointerdown', e => { e.stopPropagation(); boing(er); S.snd('whoosh'); S.snd('twinkle2', { delay: .15, vol: .7 }); cv.style.opacity = 0; S.t(() => { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.opacity = 1; }, 460); });
} });

/* 5. 색깔 실로폰 + 춤추는 친구 */
GAMES.push({ id: 'xylo', icon: 'musical-notes', color: '#ffe8cc', start(st, S) {
  st.className = 'g-xylo';
  const dancer = el('div', 'dancer', st), di = im('penguin', dancer); dancer.style.animation = 'bob 2s ease-in-out infinite';
  const bars = el('div', 'bars', st);
  const N = [['xy_C5', '#ff6b6b'], ['xy_D5', '#ffa94d'], ['xy_E5', '#ffd43b'], ['xy_G5', '#51cf66'], ['xy_A5', '#339af0'], ['xy_C6', '#9775fa']];
  const els = N.map(([n, c], i) => { const b = el('div', 'bar', bars); b.style.background = c; b.style.height = (100 - i * 6.5) + '%'; b.dataset.i = i; return b; });
  const PALS = ['penguin', 'teddy-bear', 'panda', 'frog', 'unicorn']; let hits = 0, flip = 1;
  const poses = [[{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg) translateY(-12%)' }, { transform: 'rotate(0)' }], [{ transform: 'rotate(0)' }, { transform: 'rotate(14deg) translateY(-12%)' }, { transform: 'rotate(0)' }], [{ transform: 'scale(1)' }, { transform: 'scale(1.15,.85)' }, { transform: 'scale(.9,1.15) translateY(-16%)' }, { transform: 'scale(1)' }], [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg) translateY(-10%)' }]];
  function hit(i) {
    const [n, c] = N[i], b = els[i]; S.snd(n);
    b.classList.add('hit'); S.t(() => b.classList.remove('hit'), 120);
    const p = center(b); floatUp(st, p.x, p.y - p.h / 2, pick(['musical-note', 'musical-notes']), 48, i * 55);
    hits++; const pose = hits % 9 === 0 ? poses[3] : poses[hits % 3];
    di.animate(pose, { duration: hits % 9 === 0 ? 600 : 300, easing: 'ease-out' });
    if (hits % 24 === 0) { S.t(() => { di.src = src(PALS[(hits / 24) % PALS.length]); boing(di, 1.3); S.snd('boing', { vol: .7 }); }, 200); }
  }
  const P = new Map();
  const at = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.classList.contains('bar') ? +e.dataset.i : -1; };
  S.on(st, 'pointerdown', e => { const i = at(e.clientX, e.clientY); P.set(e.pointerId, i); if (i >= 0) hit(i); else if (dancer.contains(e.target) || e.target === dancer) { boing(di); S.snd('boing', { vol: .7 }); } });
  S.on(st, 'pointermove', e => { if (!P.has(e.pointerId)) return; const i = at(e.clientX, e.clientY); if (i !== P.get(e.pointerId)) { P.set(e.pointerId, i); if (i >= 0) hit(i); } });
  const up = e => P.delete(e.pointerId); S.on(st, 'pointerup', up); S.on(st, 'pointercancel', up);
  dancer.style.pointerEvents = 'auto';
} });

/* 6. 비행기 창문 닦기 */
GAMES.push({ id: 'window', icon: 'window', color: '#d3f9d8', start(st, S) {
  st.className = 'g-window';
  const SCENES = [
    { bg: 'linear-gradient(180deg,#5cb8ff,#bfe6ff)', it: [['sun-with-face', 72, 20, 30, 1], ['rainbow', 34, 58, 52, 0], ['cloud', 22, 24, 34, 1], ['cloud', 74, 76, 34, 1], ['bird', 58, 44, 18, 1]] },
    { bg: 'linear-gradient(180deg,#8ad4ff 0,#c8ecff 46%,#3aa0e0 46%,#1f78c4 100%)', it: [['sun', 78, 14, 20, 1], ['desert-island', 30, 52, 38, 0], ['sailboat', 74, 47, 22, 1], ['spouting-whale', 66, 72, 36, 1], ['dolphin', 26, 84, 24, 1]] },
    { bg: 'linear-gradient(180deg,#141b4f,#3d2f7c)', it: [['crescent-moon', 70, 22, 30, 1], ['glowing-star', 22, 18, 14, 1], ['star', 40, 34, 10, 1], ['star', 82, 50, 10, 1], ['rocket', 36, 64, 34, 1], ['sparkles', 70, 80, 16, 1]] },
    { bg: 'linear-gradient(180deg,#ffd1e8,#fff2c9)', it: [['rainbow', 50, 30, 60, 0], ['cloud', 50, 78, 62, 0], ['unicorn', 50, 58, 38, 1], ['butterfly', 20, 24, 16, 1], ['honeybee', 82, 22, 14, 1]] }
  ];
  const fr = el('div', 'wframe', st), glass = el('div', 'glass', fr), scene = el('div', 'scene', glass), fog = el('canvas', 'fog', glass), fx = fog.getContext('2d', { willReadFrequently: true });
  const size = () => { const vw = st.clientWidth, vh = st.clientHeight; let h = vh * .82, w = h * .72; if (w > vw * .8) { w = vw * .8; h = w / .72; } fr.style.width = w + 'px'; fr.style.height = h + 'px'; };
  size(); S.on(window, 'resize', size);
  let si = 0, wiping = false, done = false, lastS = 0, lastW = 0;
  function setScene(i) { const sc = SCENES[i % SCENES.length]; scene.style.background = sc.bg; scene.innerHTML = ''; sc.it.forEach(([n, x, y, w, f]) => { const d = el('div', 'it' + (f ? ' float' : ''), scene); d.style.cssText = `left:${x}%;top:${y}%;width:${w}%;animation-delay:-${rand(0, 3)}s`; im(n, d); }); }
  function drawFog() {
    const w = fog.clientWidth || 300, h = fog.clientHeight || 400; fog.width = w; fog.height = h;
    fx.globalCompositeOperation = 'source-over';
    const g = fx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(236,242,247,.97)'); g.addColorStop(1, 'rgba(224,233,240,.97)'); fx.fillStyle = g; fx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { fx.fillStyle = `rgba(255,255,255,${rand(.15, .5)})`; fx.beginPath(); fx.arc(rand(0, w), rand(0, h), rand(1, 4), 0, 7); fx.fill(); }
    for (let i = 0; i < 40; i++) { fx.fillStyle = `rgba(190,205,218,${rand(.15, .35)})`; fx.beginPath(); fx.arc(rand(0, w), rand(0, h), rand(2, 6), 0, 7); fx.fill(); }
  }
  setScene(0); S.t(drawFog, 30);
  const R = () => Math.max(38, fog.width * .11);
  function wipe(x0, y0, x1, y1) {
    fx.globalCompositeOperation = 'destination-out'; const r = R(), d = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, d / (r / 3));
    for (let k = 0; k <= steps; k++) { const x = x0 + (x1 - x0) * k / steps, y = y0 + (y1 - y0) * k / steps; const g = fx.createRadialGradient(x, y, r * .35, x, y, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, r, 0, 7); fx.fill(); }
    const now = performance.now();
    if (now - lastW > 170) { lastW = now; S.snd('wipe', { rate: rand(.85, 1.2), vol: .8 }); }
    if (now - lastS > 650 && Math.random() < .6) { lastS = now; S.snd('squeak', { rate: rand(.85, 1.15), vol: .7 }); }
  }
  function cleared() { const d = fx.getImageData(0, 0, fog.width, fog.height).data; let c = 0, t = 0; for (let i = 3; i < d.length; i += 64) { t++; if (d[i] < 90) c++; } return c / t; }
  const P = new Map();
  const loc = e => { const r = fog.getBoundingClientRect(); return [(e.clientX - r.left) * fog.width / r.width, (e.clientY - r.top) * fog.height / r.height]; };
  S.on(fog, 'pointerdown', e => { if (done) return; fog.setPointerCapture(e.pointerId); const [x, y] = loc(e); P.set(e.pointerId, [x, y]); wipe(x, y, x, y); });
  S.on(fog, 'pointermove', e => { if (done || !P.has(e.pointerId)) return; const [x, y] = loc(e), [px, py] = P.get(e.pointerId); wipe(px, py, x, y); P.set(e.pointerId, [x, y]); });
  const up = e => P.delete(e.pointerId); S.on(fog, 'pointerup', up); S.on(fog, 'pointercancel', up);
  S.iv(() => {
    if (done || !P.size) return;
    if (cleared() > .62) {
      done = true; P.clear(); fog.style.opacity = 0; S.snd('yay'); S.t(() => Voice.say('와아!', { pitch: 1.4 }), 200);
      [...scene.children].forEach((c, k) => S.t(() => boing(c, 1.25), 200 + k * 120));
      const p = center(glass); S.t(() => burst(st, p.x, p.y, { n: 16, imgs: ['sparkles', 'star', 'glowing-star'], size: 50, spread: p.w * .6 }), 250);
      S.t(() => { drawFog(); fog.style.opacity = 1; S.snd('wipe', { vol: .5, rate: .6 }); S.t(() => { si++; setScene(si); done = false; }, 750); }, 4200);
    }
  }, 350);
} });

/* 7. 냠냠 먹이 주기 */
GAMES.push({ id: 'feed', icon: 'red-apple', color: '#ffe3e3', start(st, S) {
  st.className = 'g-feed';
  const EATERS = shuffle(['bear', 'pig-face', 'monkey-face', 'rabbit-face', 'hippopotamus', 'hamster', 'panda', 'frog']);
  const FOODS = ['red-apple', 'banana', 'strawberry', 'grapes', 'carrot', 'watermelon', 'cookie', 'cherries', 'tangerine', 'peach', 'cupcake', 'doughnut', 'ice-cream'];
  const eater = el('div', 'eater', st), ei = im(EATERS[0], eater), tummy = el('div', 'tummy', st), tray = el('div', 'tray', st);
  const slots = [...Array(5)].map(() => el('span', '', tummy));
  let ix = 0, count = 0, busy = false;
  const plates = [...Array(5)].map(() => { const p = el('div', 'plate', tray), n = pick(FOODS), i = im(n, p); i.dataset.n = n; return p; });
  plates.forEach(p => S.on(p, 'pointerdown', () => {
    if (p.classList.contains('empty') || busy) return;
    const food = p.firstChild, from = center(food), to = center(ei);
    const ty = to.y + to.h * .12;
    p.classList.add('empty'); S.snd('whoosh', { vol: .7 }); S.snd('pick', { vol: .7 });
    const f = im(food.dataset.n, st, 'fx');
    f.style.cssText += `left:${from.x}px;top:${from.y}px;width:${from.w}px`;
    const mx = (from.x + to.x) / 2, my = Math.min(from.y, ty) - 140;
    const a = anim(f, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: `translate(calc(-50% + ${mx - from.x}px),calc(-50% + ${my - from.y}px)) scale(1.1) rotate(180deg)`, offset: .5 }, { transform: `translate(calc(-50% + ${to.x - from.x}px),calc(-50% + ${ty - from.y}px)) scale(.3) rotate(360deg)` }], { duration: 620, easing: 'ease-in-out' });
    const fsrc = food.src;
    a.onfinish = () => {
      f.remove(); S.snd(pick(['chomp1', 'chomp2', 'chomp3']));
      ei.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08,.9)' }, { transform: 'scale(.95,1.06)' }, { transform: 'scale(1.08,.9)' }, { transform: 'scale(1)' }], { duration: 500 });
      burst(st, to.x, ty, { n: 7, colors: ['#e8a85a', '#ffd8a8', '#c97a3a'], imgs: ['red-heart'], size: 30, spread: 80, gravity: true });
      if (count < 5) { const sl = slots[count]; sl.innerHTML = ''; const mi = el('img', '', sl); mi.src = fsrc; boing(sl, 1.3); }
      count++; eater.style.scale = 1 + count * 0.045;
      if (count >= 5) {
        busy = true; S.t(() => { S.snd('yum'); S.t(() => S.snd('yay'), 350); Voice.say('냠냠, 맛있어!', { pitch: 1.4 });
          ei.animate([{ transform: 'rotate(0) translateY(0)' }, { transform: 'rotate(-12deg) translateY(-14%)' }, { transform: 'rotate(12deg) translateY(-14%)' }, { transform: 'rotate(0) translateY(0)' }], { duration: 900 });
          for (let k = 0; k < 3; k++) S.t(() => burst(st, to.x + rand(-60, 60), to.y, { n: 8, imgs: ['red-heart', 'orange-heart', 'sparkles', 'yellow-heart'], size: 50, spread: 200 }), k * 250);
        }, 450);
        S.t(() => {
          anim(eater, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(60vw)', opacity: 0 }], { duration: 450, easing: 'ease-in' }).onfinish = () => {
            ix++; ei.src = src(EATERS[ix % EATERS.length]); count = 0; eater.style.scale = 1; slots.forEach(s => s.innerHTML = '');
            anim(eater, [{ transform: 'translateX(-60vw)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 550, easing: 'cubic-bezier(.3,1.3,.5,1)' }).onfinish = () => { busy = false; };
            S.snd('boing', { vol: .6 });
          };
        }, 3200);
      }
    };
    S.t(() => { const nn = pick(FOODS); food.dataset.n = nn; food.src = src(nn); p.classList.remove('empty'); }, 800);
  }));
  S.on(eater, 'pointerdown', () => { boing(ei); S.snd('boing', { vol: .6 }); });
  eater.style.pointerEvents = 'auto';
} });

/* 8. 부릉부릉 탈것 */
GAMES.push({ id: 'cars', icon: 'automobile', color: '#fff3bf', start(st, S) {
  st.className = 'g-cars';
  el('div', 'road', st); im('sun-with-face', st, 'sun');
  for (let i = 0; i < 3; i++) { const c = im('cloud', st, 'cloud'); c.style.cssText = `top:${4 + i * 11}%;width:${rand(14, 22)}vmin;animation-duration:${rand(45, 70)}s;animation-delay:-${rand(0, 40)}s`; }
  const V = [
    { n: 'automobile', snd: ['horn', 'engine'], say: '부릉부릉!', lane: 'road', dur: 3200 },
    { n: 'bus', snd: ['horn'], say: '빵빵!', lane: 'road', dur: 3800, size: 1.15 },
    { n: 'fire-engine', snd: ['siren'], say: '삐뽀삐뽀!', lane: 'road', dur: 3600, size: 1.1 },
    { n: 'locomotive', snd: ['whistle', 'train'], say: '칙칙폭폭!', lane: 'road', dur: 4200, size: 1.15 },
    { n: 'helicopter', snd: ['heli'], say: '두두두두!', lane: 'sky', dur: 4200 },
    { n: 'airplane', snd: ['airplane'], say: '슝!', lane: 'up', dur: 3600 }
  ];
  const bar = el('div', 'vbar', st); let live = 0;
  V.forEach(v => {
    const b = el('button', 'vbtn', bar); im(v.n, b); let cool = 0;
    S.on(b, 'pointerdown', () => {
      const now = performance.now(); boing(b, 1.15); if (now - cool < 600 || live >= 4) return; cool = now; live++;
      const W = st.clientWidth, H = st.clientHeight, sz = Math.min(W, H) * .26 * (v.size || 1);
      const d = el('div', 'veh', st), inner = el('div', 'b', d); im(v.n, inner); d.style.width = sz + 'px';
      let kf;
      if (v.lane === 'road') { const y = H * .725 - sz * .78; kf = [{ transform: `translate(${W + 20}px,${y}px)` }, { transform: `translate(${-sz - 20}px,${y}px)` }]; }
      else if (v.lane === 'sky') { const y = H * rand(.08, .22); inner.style.animationDuration = '.6s'; kf = [{ transform: `translate(${W + 20}px,${y}px)` }, { transform: `translate(${W * .5}px,${y + 40}px)` }, { transform: `translate(${-sz - 20}px,${y - 10}px)` }]; }
      else { inner.style.animation = 'none'; kf = [{ transform: `translate(${-sz}px,${H * .5}px)` }, { transform: `translate(${W + 20}px,${-sz}px)` }]; }
      const delay = settings.voice ? 550 : 0; if (settings.voice) Voice.say(v.say, { pitch: 1.4, rate: 1 });
      v.snd.forEach((s, k) => S.snd(s, { delay: delay / 1000 + k * (s === 'engine' ? .5 : .9), vol: s === 'engine' ? .6 : 1 }));
      anim(d, kf, { duration: v.dur, easing: 'linear' }).onfinish = () => { d.remove(); live--; };
      S.on(d, 'pointerdown', () => { boing(inner, 1.2); S.snd(v.snd[0], { vol: .8 }); });
      d.style.pointerEvents = 'auto';
    });
  });
} });

/* 9. 자석 퍼즐 */
GAMES.push({ id: 'puzzle', icon: 'puzzle-piece', color: '#c3fae8', start(st, S) {
  st.className = 'g-puzzle';
  const LIST = shuffle(['dog-face', 'cat-face', 'bear', 'panda', 'lion', 'frog', 'rabbit-face', 'tiger-face', 'koala', 'unicorn', 'pig-face', 'monkey-face', 'penguin', 'hamster', 'cow-face']);
  const PLAN = [2, 2, 3, 3, 4]; let round = 0;
  const board = el('div', 'board', st), ghost = el('div', 'ghost', board);
  let pieces = [];
  function layout() {
    const W = st.clientWidth, H = st.clientHeight, land = W >= H;
    const P = land ? Math.min(H * .66, W * .42) : Math.min(W * .7, H * .42);
    const bx = (W - P) / 2, by = land ? (H - P) / 2 + 10 : (H - P) / 2;
    return { W, H, P, bx, by, land };
  }
  function newRound() {
    pieces.forEach(p => p.remove()); pieces = [];
    const name = LIST[round % LIST.length], n = PLAN[round % PLAN.length], L = layout();
    const url = SVG[name] || ('svg/' + name + '.svg');
    board.style.cssText = `left:${L.bx - 10}px;top:${L.by - 10}px;width:${L.P + 20}px;height:${L.P + 20}px`;
    ghost.style.cssText = `inset:10px;background-image:url("${url}")`;
    const cells = n === 2 ? [[0, 0, .5, 1], [.5, 0, .5, 1]] : n === 3 ? [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] : [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]];
    let left = 0;
    const spots = shuffle(cells.map((c, i) => i));
    cells.forEach(([cx, cy, cw, ch], i) => {
      const pw = cw * L.P, ph = ch * L.P, pc = el('div', 'piece', st);
      pc.style.cssText = `width:${pw}px;height:${ph}px;background-image:url("${url}");background-size:${L.P}px ${L.P}px;background-position:${-cx * L.P}px ${-cy * L.P}px`;
      const tx = L.bx + cx * L.P, ty = L.by + cy * L.P;
      // scatter outside the board
      const k = spots[i], side = k % 2 === 0 ? -1 : 1; let x, y;
      if (L.land) { const zoneW = (L.W - L.P) / 2; x = side < 0 ? rand(12, Math.max(14, zoneW - pw - 12)) : L.W - zoneW + rand(12, Math.max(14, zoneW - pw - 12)); y = rand(70, L.H - ph - 20); }
      else { const zoneH = (L.H - L.P) / 2; y = side < 0 ? rand(70, Math.max(72, zoneH - ph - 8)) : L.H - zoneH + rand(8, Math.max(10, zoneH - ph - 12)); x = rand(12, L.W - pw - 12); }
      const rot = rand(-12, 12); pc._pos = { x, y, tx, ty, rot, done: false };
      pc.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg)`;
      anim(pc, [{ opacity: 0, scale: .4 }, { opacity: 1, scale: 1 }], { duration: 400, delay: i * 90, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' });
      pieces.push(pc); left++;
      let drag = null;
      const snapR = Math.max(pw, ph) * .42;
      const place = () => {
        const p = pc._pos; if (p.done) return; p.done = true; drag = null;
        anim(pc, [{ transform: `translate(${p.x}px,${p.y}px) rotate(${p.rot}deg)` }, { transform: `translate(${p.tx}px,${p.ty}px) rotate(0deg)` }], { duration: 260, easing: 'cubic-bezier(.3,1.5,.5,1)' });
        pc.classList.add('done'); S.snd('snap'); S.t(() => burst(st, p.tx + pw / 2, p.ty + ph / 2, { n: 6, imgs: ['sparkles', 'star'], size: 36, spread: 90 }), 200);
        if (--left === 0) S.t(complete.bind(null, name, L), 400);
      };
      const near = () => Math.hypot(pc._pos.x - tx, pc._pos.y - ty) < snapR;
      const move = (x, y) => { pc._pos.x = x; pc._pos.y = y; pc.style.transform = `translate(${x}px,${y}px) rotate(${pc._pos.rot * .3}deg) scale(1.06)`; };
      S.on(pc, 'pointerdown', e => { if (pc._pos.done) return; pc.setPointerCapture(e.pointerId); drag = { ox: e.clientX - pc._pos.x, oy: e.clientY - pc._pos.y, sx: e.clientX, sy: e.clientY, moved: false }; pc.style.zIndex = 10; S.snd('tap', { vol: .8 }); move(pc._pos.x, pc._pos.y); });
      S.on(pc, 'pointermove', e => { if (!drag) return; if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 10) drag.moved = true; move(e.clientX - drag.ox, e.clientY - drag.oy); if (near()) place(); });
      const up = () => { if (!drag) return; const wasTap = !drag.moved; drag = null; pc.style.zIndex = 5;
        if (near()) return place();
        if (wasTap) { // tap: hop halfway toward its spot
          const p = pc._pos, nx = p.x + (tx - p.x) * .55, ny = p.y + (ty - p.y) * .55;
          anim(pc, [{ transform: `translate(${p.x}px,${p.y}px) rotate(${p.rot}deg)` }, { transform: `translate(${nx}px,${ny}px) rotate(${p.rot / 2}deg)` }], { duration: 320, easing: 'cubic-bezier(.3,1.4,.5,1)' }).onfinish = () => { p.x = nx; p.y = ny; p.rot /= 2; if (near()) place(); };
          S.snd('boing', { vol: .5, rate: 1.2 });
        } else pc.style.transform = `translate(${pc._pos.x}px,${pc._pos.y}px) rotate(${pc._pos.rot}deg)`;
      };
      S.on(pc, 'pointerup', up); S.on(pc, 'pointercancel', up);
    });
  }
  function complete(name, L) {
    S.snd('yay'); Voice.say(NAMES[name] ? NAMES[name] + '!' : '잘했어!', { pitch: 1.35 });
    pieces.forEach(p => p.animate([{ scale: 1 }, { scale: 1.08 }, { scale: 1 }], { duration: 500, delay: 100 }));
    ghost.style.opacity = 0;
    for (let k = 0; k < 3; k++) S.t(() => burst(st, L.bx + L.P / 2 + rand(-80, 80), L.by + L.P / 2 + rand(-80, 80), { n: 10, imgs: ['sparkles', 'star', 'glowing-star', 'red-heart'], size: 54, spread: L.P * .7 }), k * 220);
    S.t(() => { ghost.style.opacity = ''; round++; newRound(); }, 3000);
  }
  newRound();
  S.on(window, 'resize', () => S.t(newRound, 200));
} });

/* 10. 잘 자, 친구들 */
GAMES.push({ id: 'sleep', icon: 'crescent-moon', color: '#d0bfff', start(st, S) {
  st.className = 'g-sleep';
  const w = el('div', 'nwin', st); im('crescent-moon', w, 'moon');
  [[12, 18], [30, 55], [55, 30], [18, 70], [70, 72]].forEach(([x, y], i) => { const s = im('star', w, 'st'); s.style.cssText = `left:${x}%;top:${y}%;animation-delay:-${i * .5}s`; });
  const bed = el('div', 'bed', st); el('div', 'pillow', bed); const row = el('div', 'sleepers', bed); el('div', 'blanket', bed);
  const dim = el('div', 'dim', st);
  const WHO = ['bear', 'rabbit-face', 'panda', 'cat-face']; let asleep = 0;
  WHO.forEach((n, i) => {
    const sp = el('div', 'sleeper', row), s = el('div', 's', sp), si = im(n, s); s.style.animationDelay = -i * .4 + 's';
    let zz = false;
    S.on(sp, 'pointerdown', () => {
      if (zz) { S.snd(pick(['twinkle1', 'twinkle3']), { vol: .5 }); return; }
      zz = true; asleep++;
      S.snd('sleep'); S.t(() => Voice.say('잘 자', { pitch: 1.2, rate: .75 }), 500);
      s.style.animation = 'none';
      anim(si, [{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-8%) rotate(-6deg)', offset: .3 }, { transform: `translateY(38%) rotate(${i % 2 ? 14 : -14}deg)` }], { duration: 1400, easing: 'ease-in-out' });
      const zloop = () => { const p = center(sp); const z = im('zzz', st, 'fx'); z.style.cssText += `left:${p.x + p.w * .25}px;top:${p.y}px;width:${p.w * .35}px`; z.style.zIndex = 21;
        anim(z, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-30%,-120%) scale(.8)', opacity: 1, offset: .3 }, { transform: 'translate(10%,-260%) scale(1)', opacity: 0 }], { duration: 2600, easing: 'ease-out' }).onfinish = () => z.remove(); };
      S.t(() => { zloop(); S.iv(zloop, 2400); }, 900);
      dim.style.opacity = asleep * .1;
      if (asleep === WHO.length) {
        S.t(() => { S.snd('lightsoff'); dim.style.opacity = .55; }, 1800);
        S.t(() => { const l = S.snd('lullaby', { vol: .75 }); if (l) l.onended = () => S.t(() => S.snd('lullaby', { vol: .55 }), 1500); }, 3200);
      }
    });
  });
} });

/* ======================================================================
   APP FLOW
   ====================================================================== */
const scr = { start: $('#start'), menu: $('#menu'), game: $('#game') };
function show(name) { Object.entries(scr).forEach(([k, e]) => e.classList.toggle('active', k === name)); }
let scope = null;
function openGame(g) {
  if (scope) scope.dispose();
  const st = $('#stage'); st.innerHTML = ''; st.className = '';
  show('game'); scope = Scope(); g.start(st, scope);
}
function toMenu() { if (scope) { scope.dispose(); scope = null; } $('#stage').innerHTML = ''; show('menu'); }

// menu tiles
const tiles = $('#tiles');
GAMES.forEach(g => {
  const t = el('button', 'tile', tiles); t.style.background = g.color; im(g.icon, t);
  t.addEventListener('pointerdown', () => { t.classList.add('press'); Snd.play('pick', { vol: .8 }); setTimeout(() => { t.classList.remove('press'); openGame(g); }, 160); });
});
holdButton($('#homeBtn'), 1000, () => { Snd.play('hide', { vol: .6 }); toMenu(); });

// settings
const setPanel = $('#settings');
holdButton($('#gear'), 1000, () => { $('#vol').value = settings.vol; $('#voice').checked = settings.voice; setPanel.hidden = false; checkOffline(); });
$('#vol').addEventListener('input', e => { settings.vol = +e.target.value; Snd.setVol(settings.vol); saveSettings(); });
$('#vol').addEventListener('change', () => Snd.play('xy_G5'));
$('#voice').addEventListener('change', e => { settings.voice = e.target.checked; saveSettings(); if (settings.voice) Voice.say('안녕!'); });
$('#closeSettings').addEventListener('click', () => setPanel.hidden = true);
// allow normal touch on the settings panel controls
setPanel.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

// start screen decoration
[['bear', 12, 18], ['balloon', 82, 14], ['penguin', 16, 70], ['red-apple', 84, 66], ['automobile', 50, 80]].forEach(([n, x, y], i) => { const p = im(n, $('#startPals')); p.style.cssText = `left:${x}%;top:${y}%;translate:-50% -50%;animation-delay:-${i * .5}s`; });

const status = $('#status');
let decoding = null;
function prepare() { if (!decoding) { Snd.create(); decoding = Snd.decodeAll((d, n) => { if (d < n) status.textContent = `소리 준비 중… ${d}/${n}`; }); decoding.then(() => checkOffline()); } return decoding; }
Voice.init();
prepare();
$('#playBtn').addEventListener('pointerdown', async () => {
  Snd.unlock(); Voice.unlock(); keepAwake();
  await prepare();
  Snd.play('yay', { vol: .7 });
  show('menu');
});

// offline status (for parents)
async function checkOffline() {
  let msg = '';
  try {
    if (!('serviceWorker' in navigator)) msg = '이 브라우저는 오프라인 저장을 지원하지 않아요.';
    else {
      const keys = await caches.keys(); const c = keys.find(k => k.startsWith('kids-games-'));
      if (c) { const n = (await (await caches.open(c)).keys()).length; msg = n >= (window.ASSET_COUNT || 1) ? `✓ 오프라인 준비 완료 (${n}개 파일 저장됨) — 비행기 모드에서도 실행됩니다.` : `오프라인 저장 중… (${n}/${window.ASSET_COUNT})`; }
      else msg = '오프라인 저장 대기 중 — 인터넷 연결 상태에서 한 번 열어 두세요.';
    }
  } catch (e) { msg = '오프라인 상태 확인 불가'; }
  $('#offline').textContent = msg;
  if (scr.start.classList.contains('active')) status.textContent = Snd.ready ? (msg.startsWith('✓') ? '✓ 오프라인 준비 완료 · 시작 버튼을 누르세요' : '시작 버튼을 누르세요 · ' + msg) : status.textContent;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => setTimeout(checkOffline, 800)).catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'cached') checkOffline(); });
}
