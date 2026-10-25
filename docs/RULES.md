# Duel rules (one page)

These are V1's live duel rules restated for V2. The numbers live in data; this page only says what each one means.

- **Sources:** DomLynch/RPG-game trunk `codex/01a09a76/task-1` (live 82a994d15), cited as `file:line`. Also the Lead's page `frankendom-lead-catalogue/docs/v2/controls-and-combat-for-v2.md`.
- **Implementation:** `src/sim/sim.js`, the same module on the phone and the server.
- **Units:** 1 tick = 1/60 s (`src/fight/sim.ts:2`).
- **Golden rule:** no stat touches timing.

## Tick order
1. Actions are decided from the pre-tick state.
2. Phases advance and bodies move. Bodies are pushed apart to 0.85 m.
3. Contacts resolve against a snapshot, so trades land both ways (`duel.ts:341,409,509`).

A phase is age 0 on the tick it starts.

## Moves (`data/move-defs.json`)
| Rule | Value | Source |
|---|---|---|
| Light (wind-up / active / recovery) | 20 / 5 / 25 | `move-defs.json:3-4` + longsword rv86 overlay `weapon-defs.json:6` |
| Chained light | 16 / 5 / 20, inside an 18-tick window, to the other light or the heavy | same |
| Heavy | 32 / 5 / 31 (chained 22) | `move-defs.json:5` |
| Thrust | 19 / 6 / 16 | rv86 overlay |
| Ripostes | slash 12 / 5 / 19 for 24; thrust the same for 24; heavy 20 / 5 / 25 for 30 | `move-defs.json:7-9` |
| Kick | 18 / 1 / 25 for 4; unparryable; drains 15 stamina on a clean hit | `move-defs.json:12`, `duel.ts:629` |

- **Hit:** inside the active frames, within the move's `reach` (m) and within the hit arc of the attacker's facing: π/3 for blades (inferred), π/4 for the kick (`rules-defs.json:49`).
- **Wind-up turn:** 0.3 rad snap at the start, then up to 0.25 rad per tick (`rules-defs.json:94-95`).
- **Lunge:** `stepIn` × 3 m/s after tick 3 (`rules-defs.json:93`).

## Guard and parry (`data/rules.json` → `guard`, `parry`)
| Rule | Value | Source |
|---|---|---|
| Guard sides | five: straight (thrust), left, right, overhead, low. A side covers the mirrored cut; low covers the kick | `moves.ts:28`, `duel.ts:228-234` |
| Facing | covers only if the attacker is within π/3 of the guard's facing | `rules-defs.json:25`, `duel.ts:551` |
| Block | costs the move's `staminaDamage`, chips `damage × chip`, adds the move's posture, opens a 20-tick counter window (the next heavy is `heavy_counter`) | `duel.ts:595-603`, `rules-defs.json:57` |
| Perfect block | ticks 10-12 of a fresh press: half cost, no chip, half posture | `rules-defs.json:22-23,63` |
| Guard break | a guard-breaking move, a charged heavy, or a guard that can't pay: full damage, 60 stamina, posture to 0, stagger | `rules-defs.json:21`, `duel.ts:558,606` |
| Parry | a fresh GUARD press opens a 10-tick window, then a 30-tick cooldown. A parry stuns the attacker 90 ticks and adds 25 posture | `rules-defs.json:15-17,62`, `duel.ts:588-592` |
| Riposte | for 90 ticks after a parry, light → `slash_riposte`, stab → `riposte`, heavy → `heavy_riposte` | `duel.ts:255-257` |
| Whiffed parry | GUARD let go after the window with nothing met: exposed 8 ticks, can't guard | `rules-defs.json:18`, `duel.ts:419` |
| Feint | GUARD during a wind-up before `feintUntil` turns the swing into a guard. Costs 10 | `rules-defs.json:19`, `duel.ts:395-401` |

## Evasion (`roll`, `backstep`)
| Rule | Value | Source |
|---|---|---|
| Roll | 36 ticks, invulnerable on ticks 4-20, costs 30, moves at 5.2 m/s. Direction is set at the press (stick, else away from the foe) | `rules-defs.json:5-8`, `duel.ts:356-357,583` |
| Backstep | 12 ticks, costs 10, moves at 3 m/s. A swing can cancel it from tick 8; it can grow into a roll by paying the 20 difference | `rules-defs.json:9-12`, `duel.ts:291,358` |
| Clean dodge | opens a 20-tick counter window | `sandbox-rules-defs.json:4-5` |
| After an evade | a light within 2 ticks uses chained timing | `rules-defs.json:13` |

## Hits (`counter`, `rear`, `stopHit`, `charge`, `posture`)
| Rule | Value | Source |
|---|---|---|
| Clean hit | hurt for the move's stagger; knockback = `knockback` ticks at 3 m/s | `duel.ts:559-576` |
| Counter-hit (target mid-swing, or rolling past tick 20) | ×1.25 damage, ×1.5 stagger | `rules-defs.json:50-51` |
| Thrust stop-hit (into a swing, or a target walking onto the point) | ×1.5 damage, ×1.75 stagger. A whiffed thrust hangs 10 ticks | `rules-defs.json:83-86` |
| Rear hit (outside ±135° of facing) | ×1.25 damage, ×1.25 stagger, ×1.5 posture | `rules-defs.json:52-56` |
| Charged heavy (held 30-54 ticks at its chamber tick) | ×1.5 damage, ×1.5 stagger, breaks guard | `rules-defs.json:87-90`, `duel.ts:428-431` |
| Hyper-armour | a swing with `poise` ≥ the incoming stagger, between `poiseFrom` and the end of active, ignores stagger and knockback (damage still lands) | `duel.ts:610,633` |
| Posture | max 100. Decays 0.2/tick after 60 ticks without a gain. A break stuns 90 and gives the foe a 90-tick window where the heavy becomes `critical` (40, unparryable) | `rules-defs.json:58-65`, `duel.ts:472-483` |
| Exhausted victim of a heavy or kick | +36 stun | `rules-defs.json:44` |

## Pools (`stamina`, `health`, `death`)
| Rule | Value | Source |
|---|---|---|
| Stamina | 100. Regen 0.667/tick after 45 ticks without spending; half while guarding; none while sprinting (0.2/tick) | `pool-defs.json:5`, `rules-defs.json:39-42` |
| Exhausted at 0 | nothing is legal, speed ×0.7, until back to 20 | `rules-defs.json:43-45` |
| Health | 150. At 0: dead, a 144-tick death, then a new bout | `rules-defs.json:3,48` |
| Buffer | a press in the last 10 ticks of a committed phase is kept for 11 ticks | `rules-defs.json:91-92` |

## Presentation (never in the sim)
- **Hit-stop:** `data/hit-stop.json` holds V1's table from before it was zeroed (`src/hit-stop-rules.json` @ 223965735). Hit 50, block 30, parry 70, guard break 90, posture break 150, kill 220 ms; heavy hit 90 and heavy block 50.
  - It is multiplied by `scale`, which is 0, so V2 plays like live V1. Use `?hitstop=1` to judge the table.
  - The whole sim freezes, so both fighters stop (`src/main.ts:631-635`).
- **Camera:** V1 lock-on, 51° FOV (`camera.ts:43-91`, `scene.ts:160`).
  - back = max(4.2, 0.62·gap + 2.8) × 1.3
  - up = max(3.2, 1.3·gap) × 1.3
  - It sits 0.7 m over the right shoulder (`camera-rules-defs.json:7`).
- **Controls:** V1's live one-button layout A (`data/controls.json`).

## Left out of V2 for now
- Draw and sheathe (42 ticks).
- Specials.
- Walls and loiter rules.
- Wounds and attrition.
- The AI's habit reads.
- Record versions and era overlays (the Lead's "don't copy" list).
