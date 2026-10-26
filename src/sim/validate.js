// Data validator. Every data file has a closed key set, and so do its rows. An
// unknown key is an error, not a silent no-op. Armour is a threshold multiplier
// only, so no row anywhere may carry a block or immune field (Dom's ruling).
// Pure: callers pass parsed JSON, so it runs in Node tests and in the browser alike.

const MOVE_KEYS = ['id', 'direction', 'path', 'chainPath', 'chained', 'chain', 'windup', 'active', 'recovery', 'damage', 'stamina',
  'staminaDamage', 'stagger', 'poise', 'poiseFrom', 'breaksGuard', 'chip', 'parryable', 'knockback', 'stepIn', 'feintUntil',
  'reach', 'vsGuard', 'posture', 'chamber', 'charges', 'blade', 'bladeFrom'];
const BRAIN_KEYS = ['id', 'reaction', 'accuracy', 'parry', 'dodge', 'aggression', 'pressure', 'discipline', 'lapse', 'read',
  'feint', 'guard', 'disengage', 'circle', 'interrupt', 'kick', 'dash', 'anticipate', 'tellReaction', 'spamRun', 'spamBoth', 'specials'];
const DIAL_KEYS = ['startLastGap', 'startDecision', 'startWait', 'disengageTicks', 'retreatTicks', 'waitBase', 'waitSpread', 'waitAggrCeil',
  'rangeSlack', 'reachInset', 'advanceEps', 'loiterShare', 'backstepSlack', 'shakyShare', 'lowRetreatGap', 'farApproachGap', 'guardRollShare',
  'hardApproachGap', 'midApproachGap', 'lowCloseRetreatGap', 'circleReturnGap', 'guardHoldBase', 'guardHoldSpread', 'estimateMax',
  'kickWeight', 'baitChance', 'chargeOffset', 'thrustCloseInset', 'lateralStep', 'dashSlack', 'wallSlack', 'dodgeSafeEndMargin',
  'parryWindowMargin', 'readDecayStep', 'jitterAmp', 'interruptWindupMargin', 'forwardSpeed', 'backSpeed', 'retreatGap', 'retreatGapLow',
  'nearGap', 'sideShare', 'loiterInward', 'guardSide'];
const READ_KEYS = ['feint', 'after', 'parry', 'guardTicks', 'guardShare', 'roll', 'swings', 'lightShare', 'baitHold', 'parryBoost', 'parryCap',
  'chargeBoost', 'kickBoost', 'anticipate', 'baitShare', 'parkShare', 'holdTicks', 'latch', 'plus', 'decay', 'pokerShare', 'kickerShare',
  'spammerLapseShare', 'guardedKickBase', 'tells'];

// file -> { keys: top-level keys, rows: { arrayKey: row keys }, maps: { objectKey: its keys } }
export const SCHEMA = {
  'anim': { keys: ['about', 'weightRate', 'speedRate', 'tiltRate', 'weightFloor', 'ground', 'stepMax', 'fadeIn', 'fadeOut', 'gait', 'swing', 'react'] },
  'blood': { keys: ['about', 'spray', 'floor'] },
  'behaviours': {
    keys: ['about', 'dials', 'read', 'fight', 'defaults', 'brains'], rows: { brains: BRAIN_KEYS },
    maps: { dials: DIAL_KEYS, read: READ_KEYS, fight: ['thrustShare', 'close'], defaults: BRAIN_KEYS.filter((k) => k !== 'id') },
  },
  'camera': { keys: ['about', 'fov', 'near', 'far', 'follow', 'portrait', 'landscape', 'fighterSize', 'orbit', 'orbitNote', 'kill'] },
  'clips': { keys: ['about', 'base', 'bodySet', 'bodySets', 'hideMeshes', 'bodyWaitMs', 'guardTilt', 'sword', 'roles', 'states', 'paths'] },
  'controls': { keys: ['about', 'stick', 'strike', 'guard', 'dodge', 'buttons', 'ringLabels', 'gapPx', 'keys'], rows: { buttons: ['id', 'label', 'angle', 'sizePx'] } },
  'feel': { keys: ['about', 'cameraKick', 'flinch', 'hurtRecoil', 'blockRecoil', 'killDip', 'hurtFlashMs', 'dots', 'sparks', 'trail'] },
  'fighter-plain': { keys: ['id', 'units', 'gear'] },
  'hit-stop': { keys: ['about', 'scale', 'stop', 'heavy'], rows: { stop: ['id', 'ms'], heavy: ['id', 'ms'] } },
  'move-defs': { keys: ['about', 'moves', 'paths'], rows: { moves: MOVE_KEYS, paths: ['id', 'clip', 'source', 'windup', 'active', 'recovery'] } },
  'rules': { keys: ['about', 'tickHz', 'health', 'death', 'stamina', 'guard', 'parry', 'feint', 'roll', 'backstep', 'posture', 'counter',
    'rear', 'stopHit', 'charge', 'buffer', 'stepInFrom', 'turn', 'kickArc', 'hitArc', 'cleanDrain', 'exhaustedHitStun', 'move', 'body',
    'bands', 'flank', 'wall', 'wound', 'bloodied', 'retreat'] },
  'blades': { keys: ['about', 'hit', 'kinds'] },
  'sound': { keys: ['about', 'spriteSeconds', 'files', 'mix', 'events', 'synth', 'sprite'] },
  'specials': {
    keys: ['about', 'windup', 'reach', 'slack', 'share', 'first', 'cooldown', 'recovery', 'interruptAt', 'interruptCooldown', 'interruptEarly',
      'pushback', 'pushbackMax', 'react', 'staggerFloor', 'slots', 'pick', 'sounds'],
    rows: { slots: ['press', 'skill', 'move', 'name', 'clip'], pick: ['skill', 'move', 'name', 'clip'] },
  },
  'timing-sets': { keys: ['about', 'default', 'derive', 'sets'] },
  'stage': { keys:['source', 'sky', 'fog', 'ground', 'grid', 'ruler', 'light'] },
};

const BANNED = /^(block|blocks|immune|immunity)$/i;
const SIX_UNITS = ['head', 'torso', 'arms', 'hands', 'legs', 'feet'];
const TIMING = ['windup', 'active', 'recovery'];

function banned(value, path, errors) {
  if (Array.isArray(value)) value.forEach((v, i) => banned(v, `${path}[${i}]`, errors));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (BANNED.test(k)) errors.push(`${path}.${k}: armour may not block or grant immunity`);
      banned(v, `${path}.${k}`, errors);
    }
  }
}

// one file: returns a list of error strings (empty = valid)
export function validateFile(name, json) {
  const errors = [];
  const s = SCHEMA[name];
  if (!s) return [`${name}: no schema (add one to src/sim/validate.js)`];
  for (const k of Object.keys(json)) if (!s.keys.includes(k)) errors.push(`${name}.${k}: unknown key`);
  for (const [arr, keys] of Object.entries(s.rows || {})) {
    (json[arr] || []).forEach((row, i) => {
      for (const k of Object.keys(row)) if (!keys.includes(k)) errors.push(`${name}.${arr}[${i}] (${row.id ?? row.press}).${k}: unknown key`);
    });
  }
  for (const [obj, keys] of Object.entries(s.maps || {})) {
    for (const k of Object.keys(json[obj] || {})) if (!keys.includes(k)) errors.push(`${name}.${obj}.${k}: unknown key`);
  }
  banned(json, name, errors);
  return errors;
}

// all files together: per-file checks plus the cross-file links and the rules that hold the game together
export function validateAll(files) {
  const errors = Object.entries(files).flatMap(([name, json]) => validateFile(name, json));
  const moves = new Map((files['move-defs']?.moves || []).map((m) => [m.id, m]));
  for (const m of moves.values()) {
    for (const t of TIMING) if (!Number.isInteger(m[t]) || m[t] < 0) errors.push(`move-defs.${m.id}.${t}: whole ticks only`);
    if (m.chained) for (const t of TIMING) if (m.chained[t] != null && !Number.isInteger(m.chained[t])) errors.push(`move-defs.${m.id}.chained.${t}: whole ticks only`);
    for (const f of m.chain?.follow || []) if (!moves.has(f)) errors.push(`move-defs.${m.id}.chain.follow: no move "${f}"`);
  }
  for (const s of files.specials?.slots || []) if (!moves.has(s.move)) errors.push(`specials.${s.press}: no move "${s.move}"`);
  if (files.blades) {
    for (const m of moves.values()) for (const p of [m.blade || m.path, m.chainPath]) if (p && !files.blades.kinds[p]) errors.push(`blades.kinds: no sweep for "${p}" (move ${m.id})`);
    for (const [k, frames] of Object.entries(files.blades.kinds)) if (!frames.every((f) => f.length === 6)) errors.push(`blades.kinds.${k}: every frame is [hilt xyz, tip xyz]`);
  }
  const clips = files.clips;
  if (clips) {
    for (const [path, role] of Object.entries(clips.paths || {})) if (!clips.roles[role]) errors.push(`clips.paths.${path}: no role "${role}"`);
    for (const [state, role] of Object.entries(clips.states || {})) {
      for (const r of typeof role === 'string' ? [role] : Object.values(role)) if (!clips.roles[r]) errors.push(`clips.states.${state}: no role "${r}"`);
    }
  }
  // the one-mold rule: every body set names its rig, and the default set is the 106-joint rig
  if (clips?.bodySets) {
    for (const [k, v] of Object.entries(clips.bodySets)) if (k !== 'about' && v.rig !== 106) errors.push(`clips.bodySets.${k}: every body must be on the 106-joint rig (rig: ${v.rig})`);
    if (clips.bodySets[clips.bodySet]?.rig !== 106) errors.push(`clips.bodySet "${clips.bodySet}": the default bodies must be on the 106-joint rig`);
  }
  const units = files['fighter-plain']?.units;
  if (units) for (const u of SIX_UNITS) if (!units[u] || !Array.isArray(units[u].gear)) errors.push(`fighter-plain.units.${u}: every fighter has six units with a gear list`);
  return errors;
}
