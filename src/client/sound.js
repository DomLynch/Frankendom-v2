// V1's combat audio (data/sound.json): one sample sprite, cues played from sim events, V1's mix chain
// (compressor -> makeup -> balance, plus a room send) and the synth thump and chime on top.
// iOS only allows audio after a touchend, click or keydown (V1 main.ts ~l.100), so the context starts there.
const HEAVY = new Set(['heavy_overhead', 'heavy_riposte', 'heavy_counter', 'critical', 'skill_cleave']);

export function createSound(def, base = './') {
  let ctx = null, buffer = null, master = null, room = null;
  const voices = [];
  const last = {};   // cue -> last variant index, so a variant never repeats back to back
  const prev = [{}, {}];

  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const probe = document.createElement('audio');
    const file = probe.canPlayType('audio/ogg; codecs="opus"') ? def.files.ogg : def.files.m4a;
    fetch(base + file).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((b) => { buffer = b; }).catch((e) => console.warn('sound', e));
  }
  for (const type of ['touchend', 'click', 'keydown']) addEventListener(type, start, { passive: true });

  function play(c) {
    if (!buffer) return;
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
      const cues = keys.flatMap((k) => def.events[k] || []).slice(0, kill ? def.mix.maxOnKill : def.mix.maxPerTick);
      cues.forEach(play);
      if (events.some((e) => e.t === 'Hit')) synth(def.synth.hit);
      if (kill) synth(def.synth.kill);
    },
  };
}
