import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// a browser just big enough for src/client/sound.js: a fake Web Audio context that starts suspended and counts what it is asked to do
const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const stats = { decodes: 0, starts: 0, resumes: 0, built: 0 };
const listeners = {};
class Node {
  constructor() { this.gain = { value: 1 }; this.playbackRate = { value: 1 }; this.threshold = this.knee = this.ratio = this.attack = this.release = { value: 0 }; }
  connect(n) { return n; }
  start() { stats.starts++; }
  stop() {}
}
class FakeContext {
  constructor() { stats.built++; stats.last = this; this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = new Node(); }
  createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = { value: 0 }; return n; }
  createGain() { return new Node(); }
  createConvolver() { return new Node(); }
  createBufferSource() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createOscillator() { const n = new Node(); n.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; return n; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  decodeAudioData() { stats.decodes++; return Promise.resolve({ duration: 46 }); }
  resume() { stats.resumes++; this.state = 'running'; return Promise.resolve(); }
}
Object.assign(globalThis, {
  window: globalThis, AudioContext: FakeContext,
  addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  Audio: class { play() { return Promise.resolve(); } setAttribute() {} },
});
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.document = { hidden: false, createElement: () => ({ canPlayType: () => 'probably' }), addEventListener: (t, fn) => { (listeners['doc:' + t] ||= []).push(fn); } };
globalThis.URL.createObjectURL = () => 'blob:x';

const { createSound } = await import('../src/client/sound.js');
const def = load('sound'), specials = load('specials');
const sound = createSound(def, specials);
const tick = () => sound.onTick([{ t: 'Swing', move: 'light_right', f: 0 }], { state: { fighters: [{ phase: 'attack', landed: false }, { phase: 'ready', landed: false }] } });
const flush = () => new Promise((r) => setTimeout(r, 5));

test('the context is built and the sprite decoded at page load, before any touch', async () => {
  await flush();
  assert.equal(stats.built, 1);
  assert.equal(stats.decodes, 1, 'decode started without a gesture');
  assert.equal(stats.resumes, 0);
  assert.match(sound.status(), /^suspended\+sprite/);
});

test('nothing plays while the context is suspended (its clock is frozen: cues would burst on resume)', () => {
  const before = stats.starts;
  tick();
  assert.equal(stats.starts, before);
});

test('the first touch resumes the context and the next blow is heard at once', async () => {
  listeners.pointerup.forEach((fn) => fn({}));
  await flush();
  assert.equal(stats.resumes, 1);
  assert.equal(stats.built, 1, 'the touch does not build a second context');
  assert.equal(stats.decodes, 1, 'and does not decode again');
  const before = stats.starts;
  tick();
  assert.ok(stats.starts > before, 'a swing cue played right after the touch');
});

test('an interrupted context (call, app switch) is silent until the page comes back, then resumed', async () => {
  stats.resumes = 0;
  listeners.pageshow.forEach((fn) => fn({}));
  assert.equal(stats.resumes, 0, 'a running context is left alone');
  stats.last.state = 'interrupted';   // iOS parks it after a call, Siri or an app switch
  const before = stats.starts;
  tick();
  assert.equal(stats.starts, before, 'silent while interrupted');
  listeners['doc:visibilitychange'].forEach((fn) => fn({}));
  await flush();
  assert.equal(stats.resumes, 1);
  tick();
  assert.ok(stats.starts > before, 'heard again after the page returns');
});
