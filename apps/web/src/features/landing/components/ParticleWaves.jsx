import { useEffect, useRef } from 'react';
import { useTheme } from '../../../app/providers/ThemeProvider.jsx';
import { deviceBudget } from '../particleBudget.js';

/*
 * The landing page's animated particle-wave background: glowing electric-blue and gold particles on
 * flowing 3D wave surfaces, with a few faint lines between neighbouring particles. One fixed canvas
 * behind all content (no pointer events), drawn with Canvas 2D.
 *
 * Cost control:
 * - particle count follows the viewport size and the device (fewer on phones, few-core or low-memory devices);
 * - the pixel ratio is capped, phones and low-end devices draw at 30 fps, desktops at up to 60 fps;
 * - glow comes from pre-rendered sprites (no shadowBlur);
 * - the loop stops while the tab is hidden;
 * - with prefers-reduced-motion one still frame is drawn and nothing animates.
 * The effect is strongest in the hero and fades as the page scrolls down.
 */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// A stable pseudo-random value in [0, 1) for grid cell (i, j) and a seed.
const hash = (i, j, s) => {
  const n = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

// Wave layers, back to front. Sizes are in CSS pixels; `horizon` and `height` place each surface on screen.
const LAYERS = [
  { key: 'deep', color: 'blue', cols: 70, rows: 24, horizon: 0.4, height: 0.42, amp: 0.16, speed: 0.32, fx: 5.2, fz: 2.6, size: 2.1, alpha: 0.5, lines: 0.1, seed: 1 },
  { key: 'mid', color: 'blue2', cols: 46, rows: 14, horizon: 0.48, height: 0.62, amp: 0.2, speed: 0.42, fx: 3.6, fz: 2.1, size: 2.8, alpha: 0.58, lines: 0.08, seed: 2 },
  { key: 'gold', color: 'gold', cols: 30, rows: 9, horizon: 0.55, height: 0.85, amp: 0.24, speed: 0.5, fx: 2.8, fz: 1.7, size: 3.4, alpha: 0.62, lines: 0.06, seed: 3 },
];

const PALETTES = {
  dark: { blue: [70, 150, 255], blue2: [110, 190, 255], gold: [255, 200, 80], blend: 'lighter', lineAlpha: 0.34, boost: 1.4 },
  light: { blue: [30, 100, 210], blue2: [40, 130, 230], gold: [215, 150, 20], blend: 'source-over', lineAlpha: 0.22, boost: 0.7 },
};

// A soft round glow (bright core, fading halo) in one colour, drawn once and reused for every particle.
function makeSprite([r, g, b], light) {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // On a light page a white core reads as a hole, so the core keeps the particle's colour there.
  grad.addColorStop(0, light ? `rgba(${r},${g},${b},1)` : 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},${light ? 0.35 : 0.28})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, size, size);
  return c;
}

export function ParticleWaves() {
  const canvasRef = useRef(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    let ctx = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null;
    }
    if (!ctx) return undefined;

    const palette = PALETTES[theme === 'light' ? 'light' : 'dark'];
    const sprites = Object.fromEntries(['blue', 'blue2', 'gold'].map((k) => [k, makeSprite(palette[k], theme === 'light')]));
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    let width = 0;
    let height = 0;
    let budget = null;
    let layers = [];
    let frame = 0;
    let last = 0;
    let time = 0;
    let scrollFade = 1;

    function build() {
      width = window.innerWidth;
      height = window.innerHeight;
      budget = deviceBudget({ width, height, cores: navigator.hardwareConcurrency || 4, memory: navigator.deviceMemory || 4, coarse });
      const dpr = Math.min(window.devicePixelRatio || 1, budget.dpr);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layers = LAYERS.map((l) => {
        const cols = Math.max(12, Math.round(l.cols * budget.density));
        const rows = Math.max(5, Math.round(l.rows * budget.density));
        const n = cols * rows;
        // Which right/back neighbours this particle is linked to (fixed per particle, so the lines don't flicker).
        const linkRight = new Uint8Array(n);
        const linkBack = new Uint8Array(n);
        const jitter = new Float32Array(n);
        for (let j = 0; j < rows; j += 1) {
          for (let i = 0; i < cols; i += 1) {
            const k = j * cols + i;
            linkRight[k] = budget.lines && i < cols - 1 && hash(i, j, l.seed) < l.lines ? 1 : 0;
            linkBack[k] = budget.lines && j < rows - 1 && hash(j, i, l.seed + 9) < l.lines * 0.6 ? 1 : 0;
            jitter[k] = hash(i, j, l.seed + 4);
          }
        }
        return { ...l, cols, rows, n, linkRight, linkBack, jitter, px: new Float32Array(n), py: new Float32Array(n), pa: new Float32Array(n), ps: new Float32Array(n) };
      });
    }

    function readScroll() {
      const max = Math.max(1, document.documentElement.scrollHeight - height);
      const progress = clamp(window.scrollY / max, 0, 1);
      // Full strength over the hero, then gradually softer toward the lower sections.
      const hero = 1 - smooth(0, height * 0.9, window.scrollY);
      scrollFade = 0.42 + 0.28 * (1 - progress) + 0.3 * hero;
    }

    function project(layer, t) {
      const { cols, rows, px, py, pa, ps, jitter } = layer;
      const near = 1;
      const far = 4.2;
      const horizon = height * layer.horizon;
      const spanX = width * 1.5;
      const camH = height * layer.height;
      const phase = t * layer.speed;
      for (let j = 0; j < rows; j += 1) {
        const v = j / (rows - 1);
        const z = far - v * (far - near); // back row first so the front draws on top
        const inv = 1 / z;
        const depthFade = smooth(far, near + 0.6, z) * 0.85 + 0.15;
        for (let i = 0; i < cols; i += 1) {
          const k = j * cols + i;
          const u = i / (cols - 1);
          // Two travelling waves across and along the surface: a flowing swell rather than random drift.
          const wave =
            Math.sin(u * layer.fx * TAU * 0.5 + phase + v * 1.3) * 0.6 +
            Math.sin(v * layer.fz * TAU * 0.5 - phase * 1.3 + u * 2.2) * 0.4 +
            Math.sin((u + v) * 9 + phase * 2 + jitter[k] * TAU) * 0.06;
          const y = camH * (1 + wave * layer.amp * 2.2);
          px[k] = width / 2 + (u - 0.5) * spanX * inv * 1.6;
          py[k] = horizon + y * inv * 0.55;
          const edge = smooth(0, 0.12, u) * smooth(1, 0.88, u);
          const crest = 0.65 + 0.35 * (wave * 0.5 + 0.5);
          pa[k] = layer.alpha * depthFade * edge * crest * (0.75 + 0.25 * jitter[k]);
          ps[k] = layer.size * (0.55 + inv * 0.9) * (0.8 + 0.4 * jitter[k]);
        }
      }
    }

    function draw(t) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = palette.blend;
      const global = scrollFade * palette.boost;
      for (const layer of layers) {
        project(layer, t);
        const { cols, n, px, py, pa, ps, linkRight, linkBack } = layer;
        // Lines first, so the particles sit on top of them.
        if (budget.lines) {
          const [r, g, b] = palette[layer.color];
          ctx.lineWidth = 0.6;
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          for (let k = 0; k < n; k += 1) {
            if (!linkRight[k] && !linkBack[k]) continue;
            const a = pa[k] * palette.lineAlpha * global;
            if (a < 0.01) continue;
            ctx.globalAlpha = a;
            ctx.beginPath();
            if (linkRight[k]) {
              ctx.moveTo(px[k], py[k]);
              ctx.lineTo(px[k + 1], py[k + 1]);
            }
            if (linkBack[k]) {
              ctx.moveTo(px[k], py[k]);
              ctx.lineTo(px[k + cols], py[k + cols]);
            }
            ctx.stroke();
          }
        }
        const sprite = sprites[layer.color];
        for (let k = 0; k < n; k += 1) {
          const a = pa[k] * global;
          if (a < 0.015 || py[k] > height + 10 || py[k] < -10) continue;
          const s = ps[k] * 3.2; // the sprite's halo is wider than the particle's core
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(sprite, px[k] - s / 2, py[k] - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    const animate = () => !motionQuery?.matches;

    function loop(now) {
      frame = requestAnimationFrame(loop);
      const interval = 1000 / budget.fps;
      if (now - last < interval - 1) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      draw(time);
    }

    function start() {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (document.hidden) return;
      if (animate()) frame = requestAnimationFrame(loop);
      else draw(time); // reduced motion: a single still frame
    }

    let scrollQueued = false;
    function onScroll() {
      readScroll();
      // While animating the next frame picks this up; a still frame is redrawn (at most once per frame).
      if (animate() || scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        draw(time);
      });
    }

    let resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        build();
        readScroll();
        start();
      }, 150);
    }

    build();
    readScroll();
    start();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', start);
    motionQuery?.addEventListener?.('change', start);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', start);
      motionQuery?.removeEventListener?.('change', start);
    };
  }, [theme]);

  return <canvas ref={canvasRef} className="lp-particles" aria-hidden="true" />;
}
