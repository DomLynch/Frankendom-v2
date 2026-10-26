// Two timing sets for the same moves (Strategy 2026-10-26): "v1" is V1's tick table (data/move-defs.json, data/specials.json,
// rules.roll, untouched) and "clip" lasts as long as each Mixamo clip does (data/timing-sets.json). The clip set is derived from
// the clips' own rows (start / hit / end fractions and `dur` seconds in data/clips.json), so a new clip pick re-derives its
// windows; test/timing-sets.test.mjs pins the stored set to this derivation.
// Pure: takes parsed JSON, runs in Node and in the browser.

const ticks = (seconds, hz) => Math.round(seconds * hz);

function clipRow(clips, role) {
  const row = clips.roles[role];
  if (!row || !(row.dur > 0)) throw new Error(`clip role ${role}: needs dur (seconds) in data/clips.json`);
  return row;
}

// the clip's wind-up (start -> strike) and tail (strike -> end) in ticks
function spans(clips, role, hz) {
  const row = clipRow(clips, role), start = row.start ?? 0, end = row.end ?? 1;
  return { windup: ticks((row.hit - start) * row.dur, hz), tail: ticks((end - row.hit) * row.dur, hz), whole: ticks((end - start) * row.dur, hz) };
}

export function deriveClipSet(clips, T, moves, specials, rules) {
  const hz = rules.tickHz, out = { moves: {}, specials: {}, roll: null };
  const byId = Object.fromEntries(moves.moves.map((m) => [m.id, m]));
  for (const [id, role] of Object.entries(T.derive.moves)) {
    const m = byId[id], s = spans(clips, role, hz), windup = s.windup, recovery = s.tail - m.active;
    const row = { windup, active: m.active, recovery };
    if (m.chained) row.chained = {
      windup: Math.round(m.chained.windup * windup / m.windup), active: m.chained.active,
      recovery: Math.round(m.chained.recovery * recovery / m.recovery),
    };
    out.moves[id] = row;
  }
  for (const [skill, role] of Object.entries(T.derive.specials)) {
    const s = spans(clips, role, hz);
    out.specials[skill] = { windup: s.windup, recovery: s.tail };
  }
  const r = spans(clips, T.derive.roll, hz), R = rules.roll;
  out.roll = {
    ticks: r.whole,
    iframeStart: Math.round(R.iframeStart * r.whole / R.ticks), iframeEnd: Math.round(R.iframeEnd * r.whole / R.ticks),
    speedMul: Math.round((R.ticks / r.whole) * 1000) / 1000,
  };
  return out;
}

// the data the sim and the views run on for a named set; "v1" (or an unknown name) returns the data unchanged
export function applyTimingSet(data, T, name) {
  const set = T.sets[name];
  if (!set || name === 'v1') return { ...data, timingSet: 'v1', swing: null };
  const moves = data.moves.moves.map((m) => {
    const o = set.moves[m.id];
    if (!o) return m;
    return { ...m, windup: o.windup, active: o.active, recovery: o.recovery, chained: o.chained ? { ...m.chained, ...o.chained } : m.chained,
      v1: { windup: m.windup, active: m.active, recovery: m.recovery, chained: m.chained ? { windup: m.chained.windup, active: m.chained.active, recovery: m.chained.recovery } : null } };
  });
  const slot = (s) => (set.specials[s.skill] ? { ...s, ...set.specials[s.skill] } : s);
  const specials = { ...data.specials, slots: data.specials.slots.map(slot), pick: data.specials.pick.map(slot) };
  return {
    ...data, moves: { ...data.moves, moves }, specials, rules: { ...data.rules, roll: { ...data.rules.roll, ...set.roll } },
    timingSet: name, swing: set.swing || null,
  };
}

// V1's baked blade frames are one per V1 tick; with longer windows the frame index follows the move's phases: wind-up onto wind-up,
// active onto active, recovery onto recovery
export function bladeAge(age, t, v) {
  if (age <= t.windup) return t.windup ? (age * v.windup) / t.windup : 0;
  if (age <= t.windup + t.active) return v.windup + ((age - t.windup) * v.active) / t.active;
  return v.windup + v.active + ((age - t.windup - t.active) * v.recovery) / t.recovery;
}
