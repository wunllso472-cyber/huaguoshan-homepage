// 首屏「七十二变」：粒子聚成文字，定时或点击后炸开、重组成下一个词；指针靠近会把粒子拨开。

const BG = [13, 18, 51]; // 与 --ink 一致
const STOPS = ['#F5C451', '#FFB36B', '#FF7E8E', '#E58BD9', '#9F9BFF', '#5BE0C0'];
// 在色标之间插值成 18 级，避免出现明显色带
const PALETTE = (() => {
  const rgb = STOPS.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const out = [];
  const n = 18;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(t));
    const f = t - i;
    const c = rgb[i].map((v, j) => Math.round(v + (rgb[i + 1][j] - v) * f));
    out.push(`rgb(${c.join(',')})`);
  }
  return out;
})();
const CJK_FONT = '"ZCOOL QingKe HuangYou", "PingFang SC", "Microsoft YaHei", sans-serif';
const LATIN_FONT = '"Unbounded", "Arial Black", sans-serif';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createHero(canvas, words, { interval = 4200, onWord } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let N = 0;
  let particles = [];
  let index = 0;
  let raf = 0;
  let visible = true;
  let timer = 0;
  let lastInteract = 0;
  const pointer = { x: -1e4, y: -1e4 };

  words = (words && words.length ? words : ['花果山']).slice(0, 8);

  function size() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(320, Math.round(r.width));
    H = Math.max(320, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    N = Math.round(Math.min(3400, Math.max(1300, (W * H) / 380)));
  }

  // 把一个词画到离屏画布上，按网格取点
  function sample(word, want) {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const o = off.getContext('2d', { willReadFrequently: true });
    const latin = /^[\x00-\x7F]+$/.test(word);
    const family = latin ? LATIN_FONT : CJK_FONT;
    const weight = latin ? '800 ' : '';
    o.font = `${weight}100px ${family}`;
    const w100 = o.measureText(word).width || 100;
    const narrow = W < 700;
    const fontSize = Math.min((W * (narrow ? 0.9 : 0.8) * 100) / w100, H * (narrow ? 0.3 : 0.46));
    o.font = `${weight}${fontSize}px ${family}`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#fff';
    const cy = H * (narrow ? 0.4 : 0.43);
    o.fillText(word, W / 2, cy);

    const data = o.getImageData(0, 0, W, H).data;
    let filled = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 128) filled++;
    const step = Math.max(2.4, 2 * Math.sqrt(filled / want));
    const pts = [];
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (data[(yi * W + xi) * 4 + 3] > 128) pts.push([x + (Math.random() - 0.5) * step * 0.35, y + (Math.random() - 0.5) * step * 0.35]);
      }
    }
    return { pts, step };
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 渐变铺满文字本身的宽度：左金、中粉、右青
  let box = { x0: 0, x1: 1, y0: 0, y1: 1 };
  function colorFor(x, y) {
    const tx = (x - box.x0) / Math.max(1, box.x1 - box.x0);
    const ty = (y - box.y0) / Math.max(1, box.y1 - box.y0);
    const t = Math.min(0.999, Math.max(0, tx * 0.85 + ty * 0.15));
    return (t * PALETTE.length) | 0;
  }

  function morph(word, burst = true) {
    const glyphWant = Math.round(N * 0.86);
    const { pts, step } = sample(word, glyphWant);
    shuffle(pts);
    box = pts.reduce(
      (b, [x, y]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), y0: Math.min(b.y0, y), y1: Math.max(b.y1, y) }),
      { x0: W, x1: 0, y0: H, y1: 0 }
    );
    const dot = Math.min(3.4, Math.max(1.5, step * 0.62));
    if (particles.length !== N) {
      particles = Array.from({ length: N }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: 0,
        vy: 0,
        tx: 0,
        ty: 0,
        c: 0,
        s: 1.5,
        star: false,
        tw: Math.random() * Math.PI * 2,
      }));
    }
    shuffle(particles);
    const used = Math.min(pts.length, N);
    for (let i = 0; i < N; i++) {
      const p = particles[i];
      if (i < used) {
        p.tx = pts[i][0];
        p.ty = pts[i][1];
        p.star = false;
        p.s = dot * (0.8 + Math.random() * 0.4);
      } else {
        p.tx = Math.random() * W;
        p.ty = Math.random() * H;
        p.star = true;
        p.s = Math.random() < 0.15 ? 1.8 : 1.1;
      }
      p.c = colorFor(p.tx, p.ty);
      if (burst && !reduceMotion) {
        const a = Math.random() * Math.PI * 2;
        const f = 4 + Math.random() * 10;
        p.vx += Math.cos(a) * f;
        p.vy += Math.sin(a) * f;
      }
      if (reduceMotion) {
        p.x = p.tx;
        p.y = p.ty;
      }
    }
    onWord?.(index, word);
  }

  function frame(t) {
    raf = 0;
    // 留一点拖尾，形成流光（普通混合，静止时颜色收敛到原色而不会叠成白色）
    ctx.fillStyle = reduceMotion ? `rgb(${BG})` : `rgba(${BG},0.32)`;
    ctx.fillRect(0, 0, W, H);

    const R = Math.min(140, W * 0.12);
    const R2 = R * R;
    const buckets = PALETTE.map(() => []);
    for (const p of particles) {
      if (!reduceMotion) {
        const k = p.star ? 0.0025 : 0.016;
        p.vx += (p.tx - p.x) * k;
        p.vy += (p.ty - p.y) * k;
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d2 / R2) * 5.5;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
        p.vx *= p.star ? 0.94 : 0.86;
        p.vy *= p.star ? 0.94 : 0.86;
        p.x += p.vx;
        p.y += p.vy;
      }
      buckets[p.c].push(p);
    }
    for (let b = 0; b < PALETTE.length; b++) {
      ctx.fillStyle = PALETTE[b];
      const list = buckets[b];
      for (const p of list) {
        if (p.star) {
          ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(t / 900 + p.tw));
        } else {
          ctx.globalAlpha = 0.95;
        }
        ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
    if (!reduceMotion && visible) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function next() {
    index = (index + 1) % words.length;
    morph(words[index]);
    if (reduceMotion) frame(0);
  }

  function schedule() {
    clearInterval(timer);
    if (reduceMotion || words.length < 2) return;
    timer = setInterval(() => {
      if (!visible || document.hidden) return;
      if (performance.now() - lastInteract < 2500) return;
      next();
    }, interval);
  }

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    lastInteract = performance.now();
  }

  canvas.addEventListener('pointermove', setPointer);
  canvas.addEventListener('pointerdown', setPointer);
  canvas.addEventListener('pointerleave', () => {
    pointer.x = pointer.y = -1e4;
  });
  canvas.addEventListener('click', () => {
    next();
    schedule();
  });

  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const oldW = W;
      size();
      if (oldW !== W || particles.length !== N) {
        particles = [];
        morph(words[index], false);
        if (reduceMotion) frame(0);
      }
    }, 180);
  });

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) start();
  }).observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) start();
  });

  size();
  ctx.fillStyle = `rgb(${BG})`;
  ctx.fillRect(0, 0, W, H);
  morph(words[0], false);
  // 首次从四散的星点聚拢
  if (!reduceMotion) {
    for (const p of particles) {
      p.x = W / 2 + (Math.random() - 0.5) * W * 1.4;
      p.y = H / 2 + (Math.random() - 0.5) * H * 1.4;
    }
  }
  frame(0);
  start();
  schedule();

  return { next };
}

// 等字体就绪再取样，最多等 2.5 秒，超时就用系统字体
export async function waitFonts(words) {
  if (!document.fonts?.load) return;
  const text = words.join('');
  const timeout = new Promise((r) => setTimeout(r, 2500));
  await Promise.race([
    Promise.all([
      document.fonts.load(`100px "ZCOOL QingKe HuangYou"`, text),
      document.fonts.load(`800 100px "Unbounded"`, 'AI0123456789'),
    ]).catch(() => {}),
    timeout,
  ]);
}
