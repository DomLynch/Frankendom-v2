# Frankendom V2: build plan

Written 2026-10-25 from the Strategy brief (`frankendom-strategy/docs/FRANKENDOM-V2-DEV-BRIEF-2026-10-25.md`, commit d26d1aedd) and the core spec (`COMBAT-101-TOP-25-2026-10-25.md`). Nothing is built until Dom says go.

## What it is

Two fighters on a flat floor. No arena art, no menus. One sword. Bodies and clips come from the OpenTrident library on the one 106-joint rig. Frankendom's combat numbers come over as data, never its code. The prototype is 2,000 to 3,000 lines.

## Rules that shape every file

- **One sim module.** It runs at a 60 Hz fixed step and is deterministic: a seeded RNG, intents in, events out. The same file runs in the phone browser and headless in Node on the VPS. The renderer reads events and never writes back into the sim. No `Math.random`, no wall clock, no DOM or Three.js imports inside `src/sim/`.
- **Data first.** Every number lives in `data/*.json`, and a validator rejects any row it doesn't know. No tuning constant appears in code.
- **Six-unit fighter shape from day one:** head, torso, arms, hands, legs and feet, each with an equipped gear list. This holds even while both fighters are plain bodies with one sword.
- **Opponent health is per-part budgets held on the server:** head 20, torso 60, sword arm 45, off arm 70, legs 50 to 70. Damage credit goes through a server-side ledger. Phones never own an opponent's health.
- **Armour is a threshold multiplier only.** The schema rejects any `block` or `immune` field.
- **Hit windows are events outside the clip** (wind-up, active, recovery, i-frames), never baked into the animation.
- **Kill clips use `kind: finisher | special | death`.** The finisher roll is drawn from the sim seed.

## Repo layout (target)

```
data/
  move-defs.json        copied as-is from RPG-game trunk src/fight/move-defs.json (1f1ae26fa)
  rules.json            guard sides, parry window, riposte, roll + i-frames, hit-stun, hit-stop table, counter-hit mults
  controls.json         thumb layout: stick left; slash/stab/heavy pad right; guard, roll
  fighter-plain.json    one plain body: six units, gear lists, sword
  parts.json            per-part HP budgets and locational outcomes
  behaviours.json       opponent brain rows (step 3: one archetype first)
  finishers.json        kind x weapon class x hit zone x victim state (step 4)
  zone.json             one live zone row, shaped like Frankendom's zone7 row (step 3)
src/sim/                pure, shared phone + Node
  sim.js                createSim(seed, data) -> step(intents) -> events
  rng.js                seeded PRNG (mulberry32 or similar)
  fighter.js            fighter state from the six-unit shape
  moves.js              move state machine: windup/active/recovery ticks, chains, feints
  combat.js             reach test, guard side, parry, riposte, hit-stun, hit-stop, part damage
  validate.js           data validator (closed key sets, block-field lint)
src/client/
  index.html, main.js   boots the stage and the fight camera at 375 wide
  stage.js              the OpenTrident viewer scene, reused: grid floor, plain blue sky, height ruler (values in data/stage.json)
  input.js              thumb controls -> intents
  render.js             events -> body pose, clip playback, hit-stop freeze
  assets.js             loads the body GLB and clips from the OpenTrident library (read, never copied in)
  net.js                step 3: WebSocket intents up, events down
server/
  room.js               step 3: headless sim, one live zone, drop in/out, owns opponent part budgets
  ledger.js             step 3: applied-damage credit, settled on the server
docs/
  PLAN.md               this file
  RULES.md              the one-page rules spec, written from Frankendom's code
test/
  data.test.mjs         every data file parses and validates
  determinism.test.mjs  same seed + same intent stream -> byte-identical event log
  timing.test.mjs       light attack 20/8/22, heavy 32/5/31, roll 36 with i-frames 4-20
.github/workflows/ci.yml
```

## Stage and combat spec

- **Stage:** exactly the OpenTrident viewer scene: flat grid floor, plain blue sky, a height ruler, two bodies, nothing else. Source: `opentrident-steam/site/index.html`, lines 129-181 at b3c8bf0 (sky `0x9db7d6`, an 80 m GridHelper, a 1.8 m ruler with 10 cm ticks). It gets lifted into `stage.js`, with its numbers in `data/stage.json`. No arena, backgrounds or art until the combat is maxed out. Graphics come last.
- **Combat spec:** the Frankendom Lead's one page, `frankendom-lead-catalogue/docs/v2/controls-and-combat-for-v2.md` (pending), read together with `data/move-defs.json`. It covers the thumb controls, slash forward, parry, riposte, roll, hit-stun, the hit-stop table, the 375 fight camera and which clip families the old game used. `docs/RULES.md` and `data/rules.json` / `controls.json` get written from that page, not re-derived from Frankendom's code.

## The four steps

**1. Two fighters, one sword, on the phone.**
Create `src/sim/` (sim, rng, fighter, moves, the basic parts of combat), `data/move-defs.json`, `controls.json`, `fighter-plain.json` and the client. You get light and heavy attacks, guard and the thumb controls. The fight runs locally in the browser, but `sim.js` is already the module the server will import. Tests cover determinism and timing.
Delivered to a VPS preview path. Dom plays it at 375 wide. One still for Dom.

**2. The feel: parry, riposte, roll, hit-stun, hit-stop.**
Write `docs/RULES.md` from the Lead's controls-and-combat page, then `data/rules.json`, and extend `combat.js` and `moves.js`. Hit-stop is a sim event the renderer obeys, so the sim never pauses.
Acceptance: a two-minute side by side on Dom's phone where V2's light attack feels identical to V1's. One clip for Dom.

**3. Live: the sim on the server, one zone, one opponent, two phones.**
Add `server/room.js` (Node, WebSocket, the same `src/sim/sim.js`) and `ledger.js`, plus `data/zone.json`, `parts.json` and `behaviours.json`, and `src/client/net.js`. Players drop in and out of one live zone. One opponent runs on the server with per-part budgets held there. Two phones hit it and credit settles on the server. One opponent brain comes from a behaviour row.
The design borrows Armagedom's choices: one layer per area, the auth token in the WebSocket subprotocol, a token bucket, the kill switch as a row. It does not copy phone-run AI or per-phone HP. Inputs carry sequence numbers, and the server broadcasts state at its own tick. Auth (Supabase guest plus Google) waits until Dom asks for persistence. Step 3 runs with anonymous room ids.
One clip for Dom: two phones on one opponent.

**4. Finishers and ragdoll.**
Add `data/finishers.json` and a finisher picker driven by the Killed event: 25% base plus overkill, capped at 60%, 100% on match and boss kills, pity after three kills. All rolls come from the sim seed. The ragdoll layer comes from the OpenTrident physics package (Jolt) once its M3 proof lands. Deaths, knockdowns and cuts are sim outcomes, not decoration.
One clip for Dom.

## Working rules

- The Mac is for code. Builds, Chromium, clips and stills run on the VPS (`root@49.12.7.18`). GitHub Actions is the gate, and PRs merge on green.
- One branch per task, no stacked PRs. Anything the player sees ships with before/after stills at 375.
- Never touch anything Armagedom on the VPS or the storage box.

## Defaults picked (open to Dom's override)

- **No bundler.** Plain ES modules with an import map. Three.js is pinned to one exact version.
- **Node 22 LTS** in CI and on the VPS.
- **Bodies and clips:** one Mixamo character plus its phone GLB from the OpenTrident `mixamo` library. I'll confirm the canonical served path with the OpenTrident Dev before step 1. My local checkout holds only the index, not the clip files.
- **Rig check:** my local `mixamo-index.json` still lists the Mixamo characters at 68 bones. I'll confirm with the OpenTrident Dev that every served body is on the 106-joint rig before step 1 loads one.

**Rig: ONLY the OpenTrident 106-joint rig, from the OpenTrident library, for every body and clip** (Mixamo, MakeHuman, factory bodies, the ~2,500 Mixamo clips, the Hellish Quart clips). Never Frankendom's 65-bone rig, bodies, models or animation folders. From the old game we take only the data files named above.
