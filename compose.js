/* Strip composition: filters, layouts, frames, export. Exposes window.Compose. */
(function () {
  'use strict';

  const THEMES = [
    { id: 'cream', name: 'Krem', bg: '#f6efe3', ink: '#3a2a20', accent: '#c8402f' },
    { id: 'black', name: 'Hitam', bg: '#161413', ink: '#f4efe6', accent: '#e8b04c' },
    { id: 'pink', name: 'Pink', bg: '#f7d7de', ink: '#7a2945', accent: '#d9567a' },
    { id: 'mint', name: 'Mint', bg: '#d6ecdf', ink: '#1f4a3a', accent: '#3f8f6a' },
    { id: 'blue', name: 'Biru', bg: '#d7e3f4', ink: '#1f3358', accent: '#4f74b8' },
  ];

  // Photo cell aspect: duo = two 3:4 portraits side by side, solo = one 4:3 landscape.
  const DUO_HALF = { w: 3, h: 4 };
  const SOLO = { w: 4, h: 3 };

  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  const FILTERS = {
    normal: null,
    bw(d) {
      for (let i = 0; i < d.length; i += 4) {
        let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        y = clamp((y - 128) * 1.15 + 128);
        d[i] = d[i + 1] = d[i + 2] = y;
      }
    },
    sepia(d) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = clamp(0.393 * r + 0.769 * g + 0.189 * b);
        d[i + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b);
        d[i + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b);
      }
    },
    vintage(d) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // lower contrast, warm cast, lifted blacks
        d[i] = clamp(r * 0.82 + 38);
        d[i + 1] = clamp(g * 0.78 + 30);
        d[i + 2] = clamp(b * 0.62 + 34);
        const y = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        d[i] = clamp(d[i] * 0.85 + y * 0.15);
        d[i + 1] = clamp(d[i + 1] * 0.85 + y * 0.15);
        d[i + 2] = clamp(d[i + 2] * 0.85 + y * 0.15);
      }
    },
    pink(d) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = clamp(r * 0.9 + 40);
        d[i + 1] = clamp(g * 0.86 + 14);
        d[i + 2] = clamp(b * 0.88 + 30);
      }
    },
  };

  // Draw source (image/bitmap/canvas) into w x h using "cover" crop.
  function coverDraw(ctx, src, x, y, w, h) {
    const sw = src.naturalWidth || src.videoWidth || src.width;
    const sh = src.naturalHeight || src.videoHeight || src.height;
    if (!sw || !sh) return;
    const s = Math.max(w / sw, h / sh);
    const cw = w / s, ch = h / s;
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
  }

  // Grab a frame from a video element, cropped to aspect, long edge <= maxEdge, optional mirror.
  function grab(video, aspect, mirror, maxEdge) {
    maxEdge = maxEdge || 960;
    const r = aspect.w / aspect.h;
    let w, h;
    if (r >= 1) { w = maxEdge; h = Math.round(maxEdge / r); } else { h = maxEdge; w = Math.round(maxEdge * r); }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    coverDraw(ctx, video, 0, 0, w, h);
    return c;
  }

  function canvasToBlob(c, type, q) {
    return new Promise((res) => c.toBlob(res, type || 'image/jpeg', q || 0.9));
  }

  async function blobToImage(blob) {
    if (!blob) return null;
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob); } catch (e) { /* fall through */ }
    }
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = URL.createObjectURL(blob);
    });
  }

  // Filtered-photo cache so switching chips is quick.
  const cache = new Map();
  let cacheId = 0;
  function srcKey(src) {
    if (!src) return 'none';
    if (!src.__pbid) src.__pbid = ++cacheId;
    return src.__pbid;
  }
  function photo(src, w, h, filter) {
    const key = srcKey(src) + ':' + w + 'x' + h + ':' + filter;
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (src) {
      coverDraw(ctx, src, 0, 0, w, h);
      const fn = FILTERS[filter];
      if (fn) {
        const id = ctx.getImageData(0, 0, w, h);
        fn(id.data);
        ctx.putImageData(id, 0, 0);
      }
    } else {
      ctx.fillStyle = '#8a8178';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '600 ' + Math.round(h / 6) + 'px "DM Sans", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', w / 2, h / 2);
    }
    cache.set(key, c);
    return c;
  }
  function clearCache() { cache.clear(); }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPhoto(ctx, img, x, y, w, h) {
    ctx.save();
    roundRect(ctx, x, y, w, h, Math.max(6, w * 0.02));
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  // ---- decorations (vector, so they look the same on every device) ----
  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.75, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.75, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.fill();
  }
  function star(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.22 : s * 0.5;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + s / 2 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  function flower(ctx, x, y, s, center) {
    const cy = y + s / 2, pr = s * 0.2;
    for (let i = 0; i < 5; i++) {
      const a = i * (Math.PI * 2 / 5) - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * s * 0.24, cy + Math.sin(a) * s * 0.24, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    const prev = ctx.fillStyle;
    ctx.fillStyle = center;
    ctx.beginPath(); ctx.arc(x, cy, pr * 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = prev;
  }

  // Seeded RNG so decorations stay put between re-renders.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Scatter decorations in the margins/gaps, avoiding photo rects.
  function decorate(ctx, kind, W, H, rects, theme, seed) {
    if (kind === 'none') return;
    const rand = rng(seed);
    const base = Math.min(W, H);
    const count = Math.round((W * H) / 90000) + 6;
    const fns = { hearts: heart, stars: star, flowers: flower };
    const fn = fns[kind];
    if (!fn) return;
    let placed = 0, tries = 0;
    while (placed < count && tries < 600) {
      tries++;
      const s = base * (0.03 + rand() * 0.035);
      const x = rand() * W, y = rand() * H;
      const box = { x: x - s / 2, y: y, w: s, h: s };
      if (box.x < 4 || box.y < 4 || box.x + box.w > W - 4 || box.y + box.h > H - 4) continue;
      let hit = false;
      for (const r of rects) {
        if (box.x < r.x + r.w + 6 && box.x + box.w > r.x - 6 && box.y < r.y + r.h + 6 && box.y + box.h > r.y - 6) { hit = true; break; }
      }
      if (hit) continue;
      ctx.save();
      ctx.globalAlpha = 0.55 + rand() * 0.4;
      ctx.fillStyle = rand() < 0.6 ? theme.accent : theme.ink;
      ctx.translate(x, y + s / 2);
      ctx.rotate((rand() - 0.5) * 0.8);
      ctx.translate(-x, -(y + s / 2));
      fn(ctx, x, y, s, theme.bg);
      ctx.restore();
      placed++;
    }
  }

  function formatDate(d) {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
  }

  /**
   * shots: [{ a: img|null, b: img|null }]  (a = host / left, b = guest / right; solo uses a only)
   * opts: { layout: 'strip3'|'strip4'|'grid4', duo: bool, filter, theme (id), deco, title, showDate, date, seed }
   */
  function render(canvas, shots, opts) {
    const theme = THEMES.find((t) => t.id === opts.theme) || THEMES[0];
    const grid = opts.layout === 'grid4';
    const cols = grid ? 2 : 1;
    const rows = Math.ceil(shots.length / cols);
    const W = grid ? 1600 : 1200;
    const m = Math.round(W * 0.045);
    const g = Math.round(W * 0.022);
    const innerGap = Math.round(W * 0.01);
    const cellW = Math.floor((W - 2 * m - (cols - 1) * g) / cols);
    let cellH, halfW;
    if (opts.duo) {
      halfW = Math.floor((cellW - innerGap) / 2);
      cellH = Math.round(halfW * DUO_HALF.h / DUO_HALF.w);
    } else {
      cellH = Math.round(cellW * SOLO.h / SOLO.w);
    }
    const footer = Math.round(W * (grid ? 0.15 : 0.2));
    const H = m + rows * cellH + (rows - 1) * g + footer;

    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    // subtle paper grain
    const rand = rng(7);
    ctx.save();
    ctx.globalAlpha = theme.id === 'black' ? 0.05 : 0.035;
    ctx.fillStyle = theme.ink;
    for (let i = 0; i < (W * H) / 900; i++) ctx.fillRect(rand() * W, rand() * H, 1.4, 1.4);
    ctx.restore();

    const rects = [];
    shots.forEach((shot, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = m + c * (cellW + g), y = m + r * (cellH + g);
      if (opts.duo) {
        const pa = photo(shot.a, halfW, cellH, opts.filter);
        const pb = photo(shot.b, halfW, cellH, opts.filter);
        drawPhoto(ctx, pa, x, y, halfW, cellH);
        drawPhoto(ctx, pb, x + halfW + innerGap, y, halfW, cellH);
      } else {
        drawPhoto(ctx, photo(shot.a, cellW, cellH, opts.filter), x, y, cellW, cellH);
      }
      rects.push({ x, y, w: cellW, h: cellH });
    });

    // footer text
    const fy = H - footer;
    const title = (opts.title || '').trim();
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleSize = Math.round(W * (grid ? 0.055 : 0.075));
    const dateSize = Math.round(W * (grid ? 0.022 : 0.03));
    const hasDate = opts.showDate !== false;
    const titleY = fy + footer * (hasDate ? 0.42 : 0.5);
    if (title) {
      ctx.font = 'italic 500 ' + titleSize + 'px "Fraunces", Georgia, serif';
      let size = titleSize;
      while (ctx.measureText(title).width > W - 2 * m && size > 20) {
        size -= 4;
        ctx.font = 'italic 500 ' + size + 'px "Fraunces", Georgia, serif';
      }
      ctx.fillText(title, W / 2, titleY);
      rects.push({ x: W / 2 - ctx.measureText(title).width / 2, y: titleY - size * 0.6, w: ctx.measureText(title).width, h: size * 1.2 });
    }
    if (hasDate) {
      ctx.font = '500 ' + dateSize + 'px "DM Sans", system-ui, sans-serif';
      ctx.globalAlpha = 0.7;
      const ds = formatDate(opts.date || new Date()).toUpperCase().split('').join(' ');
      const dy = title ? fy + footer * 0.72 : fy + footer * 0.5;
      ctx.fillText(ds, W / 2, dy);
      ctx.globalAlpha = 1;
      const dw = ctx.measureText(ds).width;
      rects.push({ x: W / 2 - dw / 2, y: dy - dateSize, w: dw, h: dateSize * 2 });
    }

    decorate(ctx, opts.deco || 'none', W, H, rects, theme, opts.seed || 1);
    return canvas;
  }

  window.Compose = { THEMES, FILTERS, DUO_HALF, SOLO, grab, render, canvasToBlob, blobToImage, clearCache, coverDraw, formatDate };
})();
