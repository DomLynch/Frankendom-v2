# V2 feel layer, section A: status (V2 Dev, 26 Oct 2026, main at the commit that adds this file)

Source list: `frankendom-strategy/docs/FRANKENDOM-V2-FEEL-LAYER-2026-10-25.md`, section A. One line each, with the file that proves it.

| # | Item | Status | Proof |
|---|---|---|---|
| A1 | Blend times as ms rows, none above 150 | done (#70) | `data/anim.json` `blendMs` and `settleMs`; `test/blend.test.mjs`. The one named exception is `settleMs.roll` 300 (the roll-to-run's run-out into the stance, Dom 26 Oct). |
| A2 | Attack commit: no cancel once wind-up starts | done, already the sim's rule (#71) | `src/sim/sim.js` `legal()`; per-move row `feintUntil` in `data/move-defs.json`; `test/commit.test.mjs` (both timing sets). |
| A3 | Clip playback: strike at the data `hit` fraction, start offset skips the lead-in, wind-up stretched to the tick count, never slowed below 0.9x, clips never cut | done in the clip timing set, with two named, deliberate exceptions; the v1 set does not meet it | `data/clips.json` (`start`, `hit`, `dur`, no `end` rows) and `data/timing-sets.json` (windows derived from the clip). Measured wind-up playback speed (natural / sim ticks): light 1.01, thrust 1.00; the heavies 0.67 on purpose (Dom: the heavy "takes a bit longer", `derive.heavyWindupFactor` 1.5); the swing snap (`sets.clip.swing`) plays the early wind-up at about 0.83x and snaps through contact. In the v1 set (V1's tick table, kept for the A/B) heavy and kick play far below 0.9x; that is V1's timing, not changed. Dom's 26 Oct rule replaces the doc's "cut long clips": do not cut. |
| A4 | A forward step per move, feet planted on contact | step: done; planted feet: not started | `stepIn` per move in `data/move-defs.json`; under the clip windows the step keeps V1's distance (`src/sim/sim.js`, #65: stab 0.77 m, was gliding 1.4 m). Feet planted on contact is not measured or done. |
| A5 | Locomotion rows: speed, acceleration, turn rate, turn-to-face, strafe threshold | partly done | `data/rules.json` `move` (walk 2.7, strafe 0.7, back 0.6, run 5.2, `turnPull` 6/s); `data/anim.json` `gait` (`strafeFrom` / `strafeTo`, #53) and `speedRate`. Not started: an acceleration row and a 2-3 tick turn-to-face. |
| A6 | Idle: the weapon never floats, a grip socket per body | done by Dom's pick | idle = Ninja Idle `124660903` (`data/clips.json` `Armed`); the sword's grip is a data row (`data/clips.json` `sword.grip`) and `handGrip()` in `src/client/render.js`. The doc's "half-sword guard" idle was replaced by Dom's pick. |

Related open items (not section A): the opponent never throws the directional heavies; the backstep (AI only; the player has no backstep button) plays the roll clip in 12 ticks; the clip set's recoveries (1.1 to 2.1 s) may still read as floaty.
