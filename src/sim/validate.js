// Data validator. Every data file has a closed key set, and so do its rows. An
// unknown key is an error, not a silent no-op. Armour is a threshold multiplier
// only, so no row anywhere may carry a block or immune field (Dom's ruling).
// Pure: callers pass parsed JSON, so it runs in Node tests and in the browser alike.

const MOVE_KEYS = ['id', 'direction', 'path', 'chainPath', 'chained', 'chain', 'windup', 'active', 'recovery', 'damage', 'stamina',
  'staminaDamage', 'stagger', 'poise', 'poiseFrom', 'breaksGuard', 'chip', 'parryable', 'knockback', 'stepIn', 'feintUntil',
  'reach', 'vsGuard', 'posture', 'chamber', 'charges'];
const BRAIN_KEYS = ['id', 'reaction', 'accuracy', 'parry', 'dodge', 'aggression', 'lapse', 'read', 'pressure', 'thrustShare', 'kick',
  'staminaFloor', 'postureFloor', 'firstWait', 'waitBase', 'waitRand', 'waitAggro', 'bait', 'modeEvery', 'modeRand', 'far', 'near',
  'guardChance', 'close', 'approach', 'circle', 'retreat', 'reachSlack', 'reachIn', 'jitter', 'parryLead', 'rollMin', 'rollMax'];

// file -> { keys: top-level keys, rows: { arrayKey: row keys } }
export const SCHEMA = {
  'behaviours': { keys: ['about', 'brains'], rows: { brains: BRAIN_KEYS } },
  'camera': { keys: ['about', 'fov', 'near', 'far', 'back', 'height', 'fightBack', 'gapFloor', 'lookY', 'lookShift', 'side', 'lookSide', 'orbit', 'follow'] },
  'clips': { keys: ['about', 'base', 'bodies', 'hideMeshes', 'bodyWaitMs', 'sword', 'roles', 'states', 'paths'] },
  'controls': { keys: ['about', 'stick', 'strike', 'guard', 'dodge', 'buttons', 'ringLabels', 'gapPx', 'keys'], rows: { buttons: ['id', 'label', 'angle', 'sizePx'] } },
  'feel': { keys: ['about', 'cameraKick', 'flinch', 'hurtRecoil', 'blockRecoil', 'killDip', 'hurtFlashMs', 'dots', 'sparks', 'trail'] },
  'fighter-plain': { keys: ['id', 'units', 'gear'] },
  'hit-stop': { keys: ['about', 'scale', 'stop', 'heavy'], rows: { stop: ['id', 'ms'], heavy: ['id', 'ms'] } },
  'move-defs': { keys: ['about', 'moves', 'paths'], rows: { moves: MOVE_KEYS, paths: ['id', 'clip', 'source', 'windup', 'active', 'recovery'] } },
  'rules': { keys: ['about', 'tickHz', 'health', 'death', 'stamina', 'guard', 'parry', 'feint', 'roll', 'backstep', 'posture', 'counter',
    'rear', 'stopHit', 'charge', 'buffer', 'stepInFrom', 'turn', 'kickArc', 'hitArc', 'cleanDrain', 'exhaustedHitStun', 'move', 'body'] },
  'specials': { keys: ['about', 'cooldown', 'slots'], rows: { slots: ['press', 'skill', 'move', 'name'] } },
  'stage': { keys: ['source', 'sky', 'fog', 'ground', 'grid', 'ruler', 'light'] },
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
  const clips = files.clips;
  if (clips) {
    for (const [path, role] of Object.entries(clips.paths || {})) if (!clips.roles[role]) errors.push(`clips.paths.${path}: no role "${role}"`);
    for (const [state, role] of Object.entries(clips.states || {})) {
      for (const r of typeof role === 'string' ? [role] : Object.values(role)) if (!clips.roles[r]) errors.push(`clips.states.${state}: no role "${r}"`);
    }
  }
  const units = files['fighter-plain']?.units;
  if (units) for (const u of SIX_UNITS) if (!units[u] || !Array.isArray(units[u].gear)) errors.push(`fighter-plain.units.${u}: every fighter has six units with a gear list`);
  return errors;
}
