# Frankendom V2: build plan

## HANDOFF (2026-10-26 morning, Dom is clearing the session; Frankendom V2 Dev on Sonnet 5.5)

**LATEST (26 Oct, afternoon; rollback tag `v2-2026-10-26-clip-timing`): everything below is merged and live; Dom judged most of it on his phone and said the build is about 90 % there.** What changed since the paragraph below: (1) camera portrait zoom 0.9 and side 1.0, strafe clip eased in (`anim.gait.strafeFrom/To`), default opponent brain `novice` (`?brain=easy` is V1's easy); (2) TWO TIMING SETS (`data/timing-sets.json`, `src/sim/timing.js`): `clip` (default; windows as long as each Mixamo clip, derived by `scripts/derive-timings.mjs --write` from `start/hit/end/dur` in `data/clips.json`) and `v1` (V1's untouched tick table); `?timing=v1|clip`, the build label shows the set; `test/v1-parity` tests v1, `test/timing-sets.test.mjs` pins clip; Dom's rule (26 Oct): clips are never cut (no `end`), windows follow the clip; (3) per-slot special windows, roll 84 ticks with scaled i-frames and speed, blade frames follow stretched phases (`bladeAge`); (4) kick = Mixamo Kicking `90018` (timing unchanged, 18/1/25); (5) DIRECTIONAL HEAVIES `heavy_right/left/thrust` (hold STRIKE then slide; plain hold = V1 `heavy_overhead`; `controls.strike.heavyGraceMs`, `timing-sets.derive.heavyWindupFactor` 1.5); the AI does not use them yet; (6) roll weight eases out over its last 29 % (`anim.rollFadeOut`) because Quick Roll To Run ends in a run pose; (7) `assets/opentrident/SOURCES.json` + test (gladio and hs clips `unconfirmed`). Scripts: `walk-stills`, `heavy-stills`, `kick-still`, `roll-frames` (contact sheet), `ai-bout.mjs 20 7200 v1|clip`. Open: the backstep still plays the whole roll clip in 12 ticks (needs a short hop clip from Dom), the brain never throws directional heavies, queue item 3 (per-transition blend rows in ms, none above 150), stills for #42/#43 are in their bodies now. Branch `review-ai` (2 commits, no PR) is old unmerged work: ask before deleting.

**Earlier in the day: Dom's clip picks are wired, NOT yet judged by him.** Dom browsed OpenTrident and chose: idle = Ninja Idle `124660903` (`Armed`); slash = Great Sword Slash `122340901` for `Attack` (light_right, a right-to-left cut: hand x goes -0.31 -> +0.17 by the measure) and the SAME clip mirrored for `Return` (light_left; `mirror: true`, `mirrorClip` in `src/client/assets.js`: swap Left/Right bones, quaternion (x,-y,-z,w), hips x negated; the mirror is UNVERIFIED, check the left cut visually and swap Attack/Return if reversed); stab = Stabbing `100790901` (`Thrust`, start 0.1 hit 0.506); guard = Standing Block Idle `128650903` (already the Guard clip: nothing to change); roll = Quick Roll To Run `120430901` for `Roll` and the backstep (`start 0, end 0.92` cuts the run-out; roll scrub now reads `row.start/end`). Start/hit fractions were measured with `scripts/measure-clip.mjs <repo> mixamo/clips/<id>.glb` (right-hand speed vs hips, like the original rows); `scripts/swing-stills.mjs <repo> <prefix>` takes idle/cut/stab/roll stills; `scripts/still.mjs`, `scripts/vps-test.sh` are the stills and VPS-test helpers. Dom said he will paste more animation ids (kick, heavy, etc.) after the clear: add each as a `roles` row in `data/clips.json`, measure start/hit, view stills, ship. Also shipped before this: legs walk under a held guard (#48), roll no longer turns the camera, iOS sound unlock with `?snd=1` status (Dom said sound was still silent before #48: ask him for the `?snd=1` line).

**Live:** https://v2.frankendom.com at 6d6b1fe (main) before #48; #48 is 7888225. No open PRs, no WIP. Player = Girlscout (T Masuyama), opponent = Kachujin (G Rosales), OpenTrident's Mixamo bodies on the 106 rig (`models/custom/*-full-phone-mixamorig.glb`); `?body=makehuman` for the old pair. The one-mold rule is unchanged.

**Dom's reference is the live ORIGINS zone page** (Lead Dev confirmed at 82a994d15: the page walks the hero, the duel sim judges presses, guard, hits and the foe). Not the arena duel (`src/main.ts`). Read the verified V1-vs-V2 table: `~/Library/Application Support/Claude/side-session-notes/local_61f070fb-5c91-4727-8d7a-ef2f7e296dc2/v1-vs-v2-combat-recce.md`.

**Merged this session (PR numbers on GitHub):**
- #33 V1's longsword model; #35 Girlscout vs Kachujin; #34 build label never cached.
- #36 combat fidelity: V1's baked blade sweep (`data/blades.json`), positioning bands (0.4x off 1.35-1.8 m, `rules.bands`), 0.85 m ring, wounds (stamina cap, leg slow), flank, rear.downed, stop-hit `advancing`, perfect-block ticks, parry-window exposure, guard-break charged mults, wall slam and backstep refusal.
- #37/#40 input and walk: Origins walk (`rules.move`: walk 2.7 (Dom's pick, V1 is 2.3), strafe x0.7, back x0.6, run 5.2, rooted only in wind-up/active, no guard slow, heading pulled to the foe at 6/s, sprint free), backstep press = roll, lights always alternate, stick as `sf`/`ss`.
- #38 animation like V1 (`data/anim.json`): no crossfades, eased clip weights, gait blend, strafe/back clips, swing scrub keys, block/parry/deflect reaction poses; #39 wall whip + render interpolation; #42 audit fixes; #43 V1 opponent AI (`src/sim/brain.js`, rows in `data/behaviours.json`, `scripts/ai-bout.mjs`).
- #44 feel fixes: V1's own longswords (`assets/weapons/longsword-{plain,crafted,ornate}.glb`, ornate default, `?sword=plain|crafted|half`), camera orbit 0, feet kept on the ground (`keepOnGround`), idle clips drop out of the mixer.
- #45 upright Ready Idle (104210901), placeholder `Layer_*` meshes hidden (`?layers=1` shows them), walk 2.7; #46 strafe uses the Strafe Walk clips (1.95 m/s).

**Queue (PM round 22, all accepted, nothing started):**
1. Visual proof for #42 and #43: add one 375 mid-fight still to each PR body (`gh pr edit`), or one line saying why not. A mid-fight still for #42 already exists: `docs/stills/fidelity-midfight-375.png`; make one for #43 with the stills script.
2. SOURCES rows: one row per body and clip family (source URL, licence, retrieved date) for what the page loads from opentrident.org (Girlscout, Kachujin, MakeHuman pair, `mixamo/clips/`, `mixamo/clips/gladio/`, `mixamo/clips/hs/`, the library sword, the Frankendom longswords, the Half Sword weapon), plus a test that fails when a file `data/clips.json` loads has no row. Be honest on licences: Mixamo = Adobe terms; the gladio and hs clips are retargeted from games (Gladio and Glory, Half Sword) and are NOT confirmed to be redistributable: mark `unconfirmed` and tell Dom/Strategy, do not invent a licence.
3. Feel layer A1: per-transition blend rows in ms in `data/anim.json` (idle to attack 60-90, attack to recovery 80, hit 40, locomotion 120; none above 150), replacing fadeIn/fadeOut/weightRate (the PM misread fadeIn 12 as ticks; it is a fraction of the move); validator keys, a test that no row exceeds 150, a before/after 375 swing still. Then A2-A6 of `frankendom-strategy/docs/FRANKENDOM-V2-FEEL-LAYER-2026-10-25.md`, and the V1 HUD labels, and hit readability beyond the reaction poses.

**Open / not verified:** nothing has been judged on Dom's phone since 6d6b1fe. The forward walk clip plays 1.6x at 2.7 m/s; if Dom finds it hurried, blend toward a jog (no armed walk near 2.7 m/s exists; OpenTrident Dev checked). Not ported: wound scars, a special's windup freezing the caster (Pit rule), creature-only rules (poise ladder, many-on-one). Dom may send clip ids for kick/stab/slash from the OpenTrident clip panel. Timer off-by-one vs V1 (suspected, one tick) left alone.

**How to work here:** tests run on the VPS (hooks keep `node --test` and Bash file edits off the Mac): `COPYFILE_DISABLE=1 tar --no-xattrs --exclude=.git --exclude=.serena --exclude='*.mp4' --exclude='*.png' -czf - . | ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18 'rm -rf /root/f2v-dev-run && mkdir -p /root/f2v-dev-run && tar xzf - -C /root/f2v-dev-run && cd /root/f2v-dev-run && npm test'`. Stills: headless Chromium via playwright from `~/Developer/frankendom-deploy/node_modules`, route opentrident.org to add CORS. Merge only on `gh pr checks` = `test pass`. The armour lint bans any data key named block/blocks/immune. Idle peer sessions do not answer SendMessage; decide from V1 source (`git -C ~/Developer/frankendom-combat show origin/HEAD:<path>`).

## Earlier handoff (2026-10-25 night, Dom stopped work for a handover)

**Live build:** https://v2.frankendom.com at **0ecd2d7**.
- Every green main deploys itself and is checked against `build.txt`.
- Code is served under `/b/<sha>/`, so phones never run cached modules.
- Merge only when `gh pr checks` shows `test pass`.
- Stills at 375 go in the PR body for anything visible.

**What's live:**
- V1's controls, timings and rules: `test/v1-parity.test.mjs`, 24 rows that match V1.
- V1's specials: SPECIAL 1 Skull Crack, SPECIAL 2 Whirlwind.
- V1's feel layer: camera kick, flinch, sparks, trail, blood, the sound sprite and cues, the kill cam and result card.
- V1's live Origins fight camera.
- The iOS zoom guard and the iOS sound fix.
- Armoured MakeHuman pair on the 106-joint rig. The one-mold lock is enforced by CI and by the loader.

**In flight:** nothing. The working tree is clean.

**Next three:**
1. When OpenTrident sends the converted Knight and Paladin (106 rig, its new V2 tab), add them as a `rig: 106` set in `data/clips.json` and make it the default.
2. Use OpenTrident's victim reaction clips for a landed special: 116900902 big-hit-to-head for Skull Crack, 116880906 big-side-hit for Whirlwind.
3. Finishers: Decapitation and Split Crown. These are victim-only clips at `models/finishers-preview/clips/9100001-…` and need V1's `severed-head.ts` and `finisher-blood.ts` ported. Then wounds below 60 % HP, sand puffs, a real sword model, and V1's labelled HUD.

**Open questions:**
- **Dom's phone:** has he heard sound since the #26 fix and the #29 cache fix? He needs to hard-refresh once.
- **OpenTrident:** paths for the converted pair. Finisher placement and strike times weren't measured.
- **Lead:** no open asks. The "facing away" report was withdrawn; it came from a stale hidden pane.
- **Physics:** not started. It's step 4 and waits on OpenTrident's Jolt M3 proof.

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
  main.js               boots the stage and the fight camera at 375 wide (the page is index.html at the repo root)
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
  v1-parity.test.mjs    the sim, measured by input scripts, against V1 live (light 20/5/25, heavy 32/5/31, roll 36 with i-frames 4-20, ...)
.github/workflows/ci.yml
```

## Stage and combat spec

- **Stage:** exactly the OpenTrident viewer scene: flat grid floor, plain blue sky, a height ruler, two bodies, nothing else. Source: `opentrident-steam/site/index.html`, lines 129-181 at b3c8bf0 (sky `0x9db7d6`, an 80 m GridHelper, a 1.8 m ruler with 10 cm ticks). It gets lifted into `stage.js`, with its numbers in `data/stage.json`. No arena, backgrounds or art until the combat is maxed out. Graphics come last.
- **Combat spec:** the Frankendom Lead's one page, `frankendom-lead-catalogue/docs/v2/controls-and-combat-for-v2.md` (pending), read together with `data/move-defs.json`. It covers the thumb controls, slash forward, parry, riposte, roll, hit-stun, the hit-stop table, the 375 fight camera and which clip families the old game used. `docs/RULES.md` and `data/rules.json` / `controls.json` get written from that page, not re-derived from Frankendom's code.

## The four steps

**1. Two fighters, one sword, V1's full controls, on the phone.** Done (live 25 Oct).
- **Scope widened by Dom on 25 Oct:** "the full controls that we used to use on Frankendom with none of the bloat … with the thumbstick and all that special moves forward slash heavy kick dodge roll".
- So step 1 shipped every duel rule in `docs/RULES.md`: light, heavy and charge, stab, kick, five-sided guard, parry and riposte, feint, roll and backstep, posture break into a critical, counter, rear and stop-hit, hyper-armour, stamina and exhaustion, and the buffer.
- Specials are still to come.
- Files: `src/sim/` (sim, rng, brain), the `data/` rows and the client. It runs locally, and `sim.js` is the module the server will import.
- Tests cover determinism and timing.
- Live at v2.frankendom.com.

**2. The feel check.** RULES.md is done.
- Acceptance: a two-minute side by side on Dom's phone where V2's light attack feels identical to V1's.
- Hit-stop is a presentation row (`data/hit-stop.json`, scale 0 = live V1). Dom judges it with `?hitstop=1`.
- Tuning goes into data rows only. One clip for Dom.

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
