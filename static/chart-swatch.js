/*
 * Tooltip swatches that look like the lines they label.
 *
 * Chart.js draws tooltip color boxes from a dataset's backgroundColor, which is
 * transparent on our line datasets, so every box came out as an empty white square.
 * Several lines also share a color and differ only by dash pattern. This draws each
 * swatch as a short sample of the line itself (color, width and dash), or as a filled
 * block for filled area datasets. Load after Chart.js and before the page script.
 */
(function () {
  if (typeof Chart === "undefined") return;

  const W = 26, H = 12;                       // swatch size in CSS pixels
  const SCALE = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const cache = new Map();

  function isTransparent(c) {
    return !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(String(c));
  }

  function swatch(ds) {
    const filled = ds.fill && !isTransparent(ds.backgroundColor);
    const color = filled ? ds.backgroundColor : ds.borderColor;
    const width = Math.min(ds.borderWidth || 2, 3);
    const dash = (ds.borderDash || []).join(",");
    const key = [filled, color, width, dash].join("|");
    if (cache.has(key)) return cache.get(key);

    const c = document.createElement("canvas");
    c.width = W * SCALE;
    c.height = H * SCALE;
    const ctx = c.getContext("2d");
    ctx.scale(SCALE, SCALE);
    if (filled) {
      ctx.fillStyle = color;
      ctx.fillRect(4, 1, W - 8, H - 2);
      if (!isTransparent(ds.borderColor)) {
        ctx.strokeStyle = ds.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(4.5, 1.5, W - 9, H - 3);
      }
    } else {
      ctx.strokeStyle = color || "#999";
      ctx.lineWidth = width;
      ctx.setLineDash(ds.borderDash || []);
      ctx.beginPath();
      ctx.moveTo(1, H / 2);
      ctx.lineTo(W - 1, H / 2);
      ctx.stroke();
    }

    // Drawn at high resolution, displayed at W x H so it stays crisp on retina screens
    const img = new Image(W, H);
    img.src = c.toDataURL();
    cache.set(key, img);
    return img;
  }

  const tt = Chart.defaults.plugins.tooltip;
  tt.usePointStyle = true;
  tt.boxWidth = W;
  tt.boxHeight = H;
  tt.callbacks.labelPointStyle = (ctx) => ({ pointStyle: swatch(ctx.dataset), rotation: 0 });
})();
