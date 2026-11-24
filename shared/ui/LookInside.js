import * as THREE from 'three';
import { CanvasPanel, roundRect } from './CanvasPanel.js';

// "Look Inside": a small glowing button with a magnifying glass, floating beside the apparatus (the flask, the
// beakers, the potato), that opens the lesson's magnified bubble. It sits where students are already looking,
// pulses gently until it has been used, and always turns to face whoever is looking at it.
//
//   const btn = lookInside(app, { at: new THREE.Vector3(x, y, z) (lab space), isOn: () => bool, onClick });
//   btn.update(dt)   every frame

export function lookInside(app, { at, isOn, onClick, label = 'Look Inside' }) {
  const panel = new CanvasPanel({ width: 0.2, height: 0.075, pxPerMeter: 1400, name: 'look-inside' });
  panel.mesh.position.copy(at);
  panel.mesh.renderOrder = 6;
  app.lab.add(panel.mesh);
  app.panels.push(panel);
  let used = false;
  panel.setBuilder((ui) => {
    const ctx = ui.ctx;
    const W = ui.W, H = panel.canvas.height;
    const on = isOn();
    // the whole panel is the button
    ui.button({ id: 'look-inside', label: '', active: on, onClick: () => { used = true; onClick(); panel.redraw(); } }, 10, 10, W - 20, H - 20, 28);
    // a magnifying glass
    const cx = 48, cy = H / 2 - 4, r = 18;
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.72, cy + r * 0.72);
    ctx.lineTo(cx + r * 1.55, cy + r * 1.55);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(on ? 'Close' : label, 92, H / 2 + 1);
    void roundRect;
  });
  const look = new THREE.Vector3();
  return {
    panel,
    update(dt) {
      // face the viewer (turning about the vertical only)
      app.viewCamera().getWorldPosition(look);
      app.lab.worldToLocal(look);
      panel.mesh.rotation.set(0, Math.atan2(look.x - at.x, look.z - at.z), 0);
      // a gentle pulse until it has been used once
      const t = performance.now() / 1000;
      panel.mesh.scale.setScalar(!used && !isOn() ? 1 + 0.06 * Math.sin(t * 3.2) : 1);
      void dt;
    },
    refresh() { panel.redraw(); },
  };
}
