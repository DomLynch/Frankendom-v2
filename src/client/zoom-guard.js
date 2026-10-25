// Page zoom is locked on the fight surface. Ported from V1 (RPG-game src/zoom-guard.ts), which had three
// mid-fight zooms on Dom's iPhone before it held. iOS Safari ignores user-scalable=no and touch-action for
// its own gestures, so each one is refused here:
//   - the pinch gesture events;
//   - any touch with a second finger, at touchstart and touchmove, so a pinch never starts;
//   - a second single-finger touchend within 350 ms (the double-tap zoom). Every V2 control acts on
//     pointerdown, so refusing the second touchend loses nothing.

export function lockPageZoom(doc = document) {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, (e) => e.preventDefault());
  const twoFingers = (e) => { if (e.touches.length > 1) e.preventDefault(); };
  doc.addEventListener('touchstart', twoFingers, { passive: false });
  doc.addEventListener('touchmove', twoFingers, { passive: false });
  let lastEnd = -Infinity;
  doc.addEventListener('touchend', (e) => {
    if (e.touches.length === 0 && e.timeStamp - lastEnd < 350) e.preventDefault();
    lastEnd = e.timeStamp;
  }, { passive: false });
}

// The layout viewport. iOS reports the zoomed visual viewport in innerWidth/innerHeight, so a zoom that
// slipped past the guard would shrink the canvas and leave it stuck (V1 scene.ts:521-528).
export const viewW = () => document.documentElement.clientWidth || innerWidth;
export const viewH = () => document.documentElement.clientHeight || innerHeight;
