// V1's combat audio (data/sound.json): one sample sprite, cues played from sim events, V1's mix chain
// (compressor -> makeup -> balance, plus a room send) and the synth thump and chime on top.
// iOS only allows audio after a touchend, click or keydown (V1 main.ts ~l.100), so the context starts there.
const HEAVY = new Set(['heavy_overhead', 'heavy_right', 'heavy_left', 'heavy_thrust', 'heavy_riposte', 'heavy_counter', 'critical', 'skill_cleave']);

export function createSound(def, specials, base = './') {
  let ctx = null, buffer = null, master = null, room = null;
  const voices = [];
  const last = {};   // cue -> last variant index, so a variant never repeats back to back
  const prev = [{}, {}];

  // V1 audio/sprite.ts: Safari answers "maybe" for Ogg/Opus but can't decode it, so Opus goes first only on "probably";
  // otherwise AAC first, and a failed decode falls through to the other file
  const probe = document.createElement('audio');
  const opus = probe.canPlayType('audio/ogg; codecs="opus"'), aac = probe.canPlayType('audio/mp4; codecs="mp4a.40.2"');
  const order = opus === 'probably' ? [def.files.ogg, def.files.m4a] : [def.files.m4a, def.files.ogg];
  // the bytes are fetched before any touch (fetching needs no gesture), so the first blows aren't silent on a phone network
  const get = (f) => fetch(base + f).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  const first = get(order[0]);   // the fallback file is fetched only if the first one fails
  async function decode() {
    for (const [i, f] of order.entries()) {
      const b = await (i === 0 ? first : get(f));
      if (!b) continue;
      try { return await ctx.decodeAudioData(b.slice(0)); } catch { /* try the other format */ }
    }
    return null;
  }

  function start() {
    // iOS also parks the context in 'interrupted' after a call, Siri or an app switch: resume from any non-running state
    if (ctx) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS mutes "ambient" web audio under the ringer switch; a playback session plays like a game does (Safari 17+, V1 feedback.ts:75)
    if (navigator.audioSession) try { navigator.audioSession.type = 'playback'; } catch { /* older WebKit */ }
    const m = def.mix, comp = ctx.createDynamicsCompressor();
    comp.threshold.value = m.compressor.threshold; comp.knee.value = m.compressor.knee; comp.ratio.value = m.compressor.ratio;
    comp.attack.value = m.compressor.attack; comp.release.value = m.compressor.release;
    const makeup = ctx.createGain(); makeup.gain.value = m.makeup;
    const balance = ctx.createGain(); balance.gain.value = m.balance;
    comp.connect(makeup).connect(balance).connect(ctx.destination);
    master = comp;
    // the room: a short generated impulse (V1 uses a convolver "arena" room)
    room = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * m.room.seconds), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, m.room.decay);
    }
    room.buffer = ir;
    room.connect(master);
    decode().then((b) => { buffer = b; if (!b) console.warn('sound: no sprite format decoded'); });
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // the classic unlock: a one-sample buffer started inside the gesture
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch { /* not fatal */ }
  }
  // iOS plays Web Audio under the silent switch unless the page is also playing a media element: a looping silent clip puts the
  // session in "playback" mode, so a game's sounds are heard with the ringer off (the audioSession type above covers Safari 17+;
  // this covers the rest, and costs nothing). It is started from the same touch that starts the context.
  let keep = null;
  function keepAwake() {
    if (keep) { if (keep.paused) keep.play().catch(() => {}); return; }
    const n = 800, wav = new Uint8Array(44 + n), dv = new DataView(wav.buffer);
    const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
    wav.fill(128, 44);
    keep = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    keep.loop = true; keep.volume = 0.01; keep.setAttribute('playsinline', '');
    keep.play().catch(() => {});
  }
  const wake = () => { keepAwake(); start(); };
  for (const type of ['touchend', 'pointerup', 'click', 'keydown']) addEventListener(type, wake, { passive: true });

  let played = 0;
  function play(c) {
    if (!buffer) return;
    played++;
    const variants = def.sprite[c.cue];
    if (!variants) return;
    let v = Math.floor(Math.random() * variants.length);
    if (variants.length > 1 && v === last[c.cue]) v = (v + 1) % variants.length;
    last[c.cue] = v;
    const [start, dur] = variants[v];
    const at = ctx.currentTime + (c.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (c.rate || 1) * (1 + (Math.random() * 2 - 1) * def.mix.pitchJitter);
    const g = ctx.createGain(); g.gain.value = c.gain;
    src.connect(g).connect(master);
    if (c.room) { const s = ctx.createGain(); s.gain.value = c.room; g.connect(s).connect(room); }
    src.start(at, start, dur);
    voices.push(src);
    src.onended = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1); };
    while (voices.length > def.mix.voices) { try { voices.shift().stop(); } catch { /* already ended */ } }
  }

  function synth(layers) {
    const out = ctx.createGain(); out.gain.value = def.synth.outputGain; out.connect(master);
    const t0 = ctx.currentTime;
    for (const L of layers) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(L.vol, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + L.dur);
      let src;
      if (L.type === 'noise') {
        const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * L.dur), ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        src = ctx.createBufferSource(); src.buffer = b;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = L.highpass;
        src.connect(hp).connect(g);
      } else {
        src = ctx.createOscillator(); src.type = L.type;
        src.frequency.setValueAtTime(L.from, t0);
        src.frequency.exponentialRampToValueAtTime(L.to, t0 + L.dur);
        src.connect(g);
      }
      g.connect(out);
      src.start(t0);
      src.stop(t0 + L.dur + 0.02);
    }
  }

  return {
    // for ?snd=1: what the phone says about the audio, shown beside the build label
    status: () => (ctx ? `${ctx.state}${buffer ? '+sprite' : '-nosprite'}${keep && !keep.paused ? '+keep' : ''} ${played}` : 'no-touch-yet'),
    // one sim tick's events, plus the phase changes the sim doesn't emit (roll, backstep, whiff)
    onTick(events, sim) {
      if (!ctx || !buffer) return;
      const keys = [];
      const kill = events.some((e) => e.t === 'Killed');
      for (const e of events) {
        if (e.t === 'Swing') keys.push(e.move === 'kick' ? 'swing_kick' : HEAVY.has(e.move) ? 'swing_heavy' : 'swing_light');
        else if (e.t === 'Hit') keys.push(e.move === 'kick' ? 'hit_kick' : e.heavy ? 'hit_heavy' : 'hit_light');
        else if (e.t === 'Blocked') keys.push(e.perfect ? 'guard_perfect' : 'guard');
        else if (e.t === 'Parried') keys.push('parry');
        else if (e.t === 'GuardBroken') keys.push('guard_break');
        else if (e.t === 'PostureBroken') keys.push('posture_break');
        else if (e.t === 'Killed') keys.push('kill');
      }
      sim.state.fighters.forEach((f, i) => {
        const p = prev[i];
        if (f.phase === 'roll' && p.phase !== 'roll') keys.push('roll');
        if (f.phase === 'backstep' && p.phase !== 'backstep') keys.push('backstep');
        if (p.phase === 'attack' && f.phase === 'ready' && p.landed === false) keys.push('whiff');
        prev[i] = { phase: f.phase, landed: f.landed };
      });
      // specials: V1's specialSound rows, the start rows on the cast, the rest on the landed blow
      const special = events.flatMap((e) => (e.t === 'SpecialStarted' ? specials.sounds[e.skill]?.start || []
        : e.t === 'SpecialLanded' ? specials.sounds[e.skill]?.land || [] : []));
      const cues = [...special, ...keys.flatMap((k) => def.events[k] || [])].slice(0, kill ? def.mix.maxOnKill : def.mix.maxPerTick);
      cues.forEach(play);
      if (events.some((e) => e.t === 'Hit' || e.t === 'SpecialLanded')) synth(def.synth.hit);
      if (kill) synth(def.synth.kill);
    },
  };
}
