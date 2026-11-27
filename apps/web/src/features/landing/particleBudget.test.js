import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceBudget } from './particleBudget.js';

test('particle waves: phones draw fewer particles at 30 fps, pixel ratio 1 and no lines', () => {
  const phone = deviceBudget({ width: 390, height: 844, cores: 8, memory: 8, coarse: true });
  const desktop = deviceBudget({ width: 1440, height: 900, cores: 8, memory: 8, coarse: false });
  assert.ok(phone.density < desktop.density * 0.5);
  assert.deepEqual({ fps: phone.fps, dpr: phone.dpr, lines: phone.lines }, { fps: 30, dpr: 1, lines: false });
  assert.deepEqual(desktop, { density: 1, fps: 60, dpr: 1.5, lines: true });
});

test('particle waves: low-end desktops draw less, at 30 fps', () => {
  const low = deviceBudget({ width: 1440, height: 900, cores: 2, memory: 2, coarse: false });
  assert.ok(low.density < 1);
  assert.equal(low.fps, 30);
});
