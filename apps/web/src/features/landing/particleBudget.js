const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How much the particle-wave background draws on this device: a particle-count factor, a frame rate, a
 * pixel-ratio cap and whether connecting lines are drawn. Phones and low-end devices (touch, at most four
 * cores or 4 GB memory) draw fewer particles at 30 fps; phones draw no lines.
 */
export function deviceBudget({ width, height, cores, memory, coarse }) {
  const low = coarse || cores <= 4 || memory <= 4;
  const phone = width < 640;
  const area = clamp((width * height) / (1440 * 900), 0.3, 1.25);
  const density = Math.sqrt(area) * (phone ? 0.5 : low ? 0.7 : 1);
  return { density, fps: phone || low ? 30 : 60, dpr: phone || low ? 1 : 1.5, lines: !phone };
}
