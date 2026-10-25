// Thumb and keyboard input -> one intent per sim tick. Every threshold comes from
// data/controls.json (V1's live one-button layout A).
// The stick sits on the left half of the screen. On the right:
//   STRIKE: tap = light, hold = heavy, slide up = stab, slide sideways = that side's cut
//   GUARD:  press = parry, hold = guard, slide = guard side
//   ROLL:   tap = backstep (a roll if the stick is pushed), hold = roll
//   KICK
// Presses are edges: the next sim tick takes each one exactly once.

export function createInput(def, el = document.body) {
  const now = () => performance.now();
  const s = {
    stick: { x: 0, y: 0, id: null, ox: 0, oy: 0 },
    keys: new Set(),
    pending: null, side: null,
    guard: null, holding: false,
    windows: { counter: false },
  };
  const press = (p, side = null) => { s.pending = p; s.side = side; };

  // ---- stick ----
  const zone = document.getElementById('stick'), base = document.getElementById('base'), knob = document.getElementById('knob');
  const st = def.stick;
  const showStick = (on, x, y) => {
    for (const [e, d] of [[base, st.radiusPx * 2], [knob, 28]]) {
      e.style.display = on ? 'block' : 'none';
      e.style.width = e.style.height = d + 'px';
    }
    if (on) place(base, x, y, st.radiusPx * 2);
  };
  const place = (e, x, y, d) => { e.style.left = x - d / 2 + 'px'; e.style.top = y - d / 2 + 'px'; };
  zone.style.bottom = Math.max(0, st.bottomMinPx - 56) + 'px';
  zone.addEventListener('pointerdown', (e) => {
    if (s.stick.id !== null) return;
    zone.setPointerCapture(e.pointerId);
    Object.assign(s.stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    showStick(true, e.clientX, e.clientY);
    place(knob, e.clientX, e.clientY, 28);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== s.stick.id) return;
    const dx = (e.clientX - s.stick.ox) / st.radiusPx, dy = (e.clientY - s.stick.oy) / st.radiusPx;
    s.stick.x = dx; s.stick.y = dy;
    const len = Math.hypot(dx, dy) || 1, k = Math.min(1, len) * st.travelPx / len;
    place(knob, s.stick.ox + dx * k, s.stick.oy + dy * k, 28);
  });
  const endStick = (e) => {
    if (e.pointerId !== s.stick.id) return;
    Object.assign(s.stick, { id: null, x: 0, y: 0 });
    showStick(false);
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  // ---- right cluster ----
  const sk = def.strike;
  const cx = () => innerWidth - sk.fromRightPx, cy = () => innerHeight - sk.fromBottomPx;
  const ring = document.createElement('div');
  ring.id = 'ring';
  ring.innerHTML = '<b style="left:50%;top:4px;transform:translateX(-50%)">STAB</b><b style="left:6px;top:50%">CUT</b><b style="right:6px;top:50%">CUT</b>';
  el.appendChild(ring);
  const mk = (id, label, size) => {
    const b = document.createElement('div');
    b.className = 'pad';
    b.id = 'pad-' + id;
    b.textContent = label;
    b.style.width = b.style.height = size + 'px';
    el.appendChild(b);
    return b;
  };
  const strike = mk('strike', 'STRIKE', sk.sizePx);
  const buttons = def.buttons.map((b) => ({ ...b, el: mk(b.id, b.label, b.sizePx) }));
  const layout = () => {
    place(ring, cx(), cy(), sk.ringPx);
    ring.style.width = ring.style.height = sk.ringPx + 'px';
    place(strike, cx(), cy(), sk.sizePx);
    for (const b of buttons) {
      const r = (sk.ringPx + b.sizePx) / 2 + def.gapPx, a = b.angle * Math.PI / 180;
      place(b.el, cx() + Math.cos(a) * r, cy() - Math.sin(a) * r, b.sizePx);
    }
  };
  layout();
  addEventListener('resize', layout);

  const stickPushed = () => Math.hypot(s.stick.x, s.stick.y) >= st.deadZone;
  const cutSide = () => (Math.abs(s.stick.x) >= st.cutPush ? (s.stick.x < 0 ? 'left' : 'right') : null);

  // STRIKE gestures
  let sp = null;
  strike.addEventListener('pointerdown', (e) => {
    strike.setPointerCapture(e.pointerId);
    strike.classList.add('on');
    sp = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), decided: false };
  });
  strike.addEventListener('pointermove', (e) => {
    if (!sp || e.pointerId !== sp.id || sp.decided) return;
    const dx = e.clientX - sp.x, dy = e.clientY - sp.y;
    if (Math.hypot(dx, dy) < sk.slidePx) return;
    sp.decided = true;
    s.holding = true;
    const offUp = Math.abs(Math.atan2(dx, -dy)) * 180 / Math.PI;
    if (offUp <= sk.stabHalfAngleDeg) press('thrust');
    else press('light', dx < 0 ? 'left' : 'right');
  });
  const endStrike = (e) => {
    if (!sp || e.pointerId !== sp.id) return;
    if (!sp.decided) press('light', cutSide());
    sp = null;
    s.holding = false;
    strike.classList.remove('on');
  };
  strike.addEventListener('pointerup', endStrike);
  strike.addEventListener('pointercancel', endStrike);

  // GUARD, ROLL, KICK
  const btn = (id) => buttons.find((b) => b.id === id).el;
  let gp = null, rp = null;
  const g = btn('guard'), r = btn('roll'), k = btn('kick');
  g.addEventListener('pointerdown', (e) => {
    g.setPointerCapture(e.pointerId);
    g.classList.add('on');
    gp = { id: e.pointerId, x: e.clientX, y: e.clientY, side: 'thrust' };
    s.guard = 'thrust';
    press('parry');
  });
  g.addEventListener('pointermove', (e) => {
    if (!gp || e.pointerId !== gp.id) return;
    const dx = e.clientX - gp.x, dy = e.clientY - gp.y;
    if (Math.hypot(dx, dy) < def.guard.slidePx) return;
    // keep the held axis until the thumb is deadBand past the diagonal
    const deg = Math.atan2(-dy, dx) * 180 / Math.PI, band = def.guard.deadBandDeg;
    const horiz = Math.abs(Math.abs(deg) - 90) > 45 + (gp.side === 'left' || gp.side === 'right' ? -band : band);
    gp.side = horiz ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'overhead' : 'low');
    s.guard = gp.side;
  });
  const endGuard = (e) => {
    if (!gp || e.pointerId !== gp.id) return;
    gp = null;
    s.guard = null;
    g.classList.remove('on');
  };
  g.addEventListener('pointerup', endGuard);
  g.addEventListener('pointercancel', endGuard);

  r.addEventListener('pointerdown', (e) => {
    r.setPointerCapture(e.pointerId);
    r.classList.add('on');
    if (stickPushed()) { press('dodge'); rp = null; return; }
    rp = { id: e.pointerId, timer: setTimeout(() => { if (rp) { press('dodge'); rp.done = true; } }, def.dodge.holdMs) };
  });
  const endRoll = (e) => {
    r.classList.remove('on');
    if (!rp || e.pointerId !== rp.id) return;
    clearTimeout(rp.timer);
    if (!rp.done) press('backstep');
    rp = null;
  };
  r.addEventListener('pointerup', endRoll);
  r.addEventListener('pointercancel', endRoll);
  k.addEventListener('pointerdown', () => { press('kick'); k.classList.add('on'); });
  k.addEventListener('pointerup', () => k.classList.remove('on'));

  // ---- keyboard ----
  const K = def.keys, is = (code, act) => K[act].includes(code);
  let heavyKey = null, dodgeKey = null;
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    s.keys.add(e.code);
    if (is(e.code, 'light')) press('light', cutSide());
    else if (is(e.code, 'heavy')) { heavyKey = now(); s.holding = true; press('heavy'); }
    else if (is(e.code, 'thrust')) { s.holding = true; press('thrust'); }
    else if (is(e.code, 'kick')) press('kick');
    else if (is(e.code, 'guard')) { s.guard = 'thrust'; press('parry'); }
    else if (is(e.code, 'dodge')) {
      if (stickPushed()) press('dodge');
      else dodgeKey = setTimeout(() => { press('dodge'); dodgeKey = 'done'; }, def.dodge.holdMs);
    }
  });
  addEventListener('keyup', (e) => {
    s.keys.delete(e.code);
    if (is(e.code, 'heavy') || is(e.code, 'thrust')) s.holding = false;
    if (is(e.code, 'guard')) s.guard = null;
    if (is(e.code, 'dodge') && dodgeKey) { if (dodgeKey !== 'done') { clearTimeout(dodgeKey); press('backstep'); } dodgeKey = null; }
  });
  const keyStick = () => {
    const on = (a) => K[a].some((c) => s.keys.has(c));
    return { x: (on('right') ? 1 : 0) - (on('left') ? 1 : 0), y: (on('down') ? 1 : 0) - (on('up') ? 1 : 0) };
  };

  // the strike held past tapMs becomes a heavy (sooner inside a counter or punish window)
  function heldHeavy() {
    if (!sp || sp.decided) return;
    if (now() - sp.t >= (s.windows.counter ? sk.counterHoldMs : sk.tapMs)) {
      sp.decided = true;
      s.holding = true;
      press('heavy');
    }
  }

  // camera yaw: the camera looks along (-sin yaw, -cos yaw)
  return {
    state: s,
    sample(yaw, me) {
      heldHeavy();
      s.windows.counter = me.punish > 0 || me.counterWindow > 0;
      const ks = keyStick();
      let x = s.stick.x + ks.x, y = s.stick.y + ks.y;
      let len = Math.hypot(x, y);
      const sprint = len > st.sprintPush || ['ShiftLeft', 'ShiftRight'].some((c) => s.keys.has(c) && K.run.includes(c));
      if (len < st.deadZone) { x = 0; y = 0; len = 0; }
      if (len > 1) { x /= len; y /= len; }
      // guard side from the keyboard: Q + arrows
      if (s.guard && !gp && (ks.x || ks.y)) s.guard = ks.x ? (ks.x < 0 ? 'left' : 'right') : ks.y < 0 ? 'overhead' : 'low';
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
      const intent = {
        mx: rx * x - fx * y, mz: rz * x - fz * y,
        run: sprint && len > 0,
        press: s.pending, side: s.side,
        guard: s.guard, hold: s.holding,
      };
      s.pending = null;
      s.side = null;
      return intent;
    },
  };
}
