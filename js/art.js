// 商品パッケージと看板をcanvasに描く。画像ファイルを使わずに済むよう、すべて手続きで描く。
import { SECTIONS, PRODUCTS_PER_SECTION } from './catalog.js';

export const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';
export const ATLAS_GRID = 8;
const TILE = 128;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

// (cx, cy) を中心に半径 r ほどの大きさで売り場ごとのアイコンを描く
function drawIcon(ctx, type, cx, cy, r, a) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a.tilt);
  const ink = a.ink, ink2 = a.ink2;
  switch (type) {
    case 'block': {
      const s = r * 0.62;
      [[-1, 0, ink], [0, 0, ink2], [-0.5, -1, a.band]].forEach(([gx, gy, col]) => {
        const x = gx * s, y = gy * s * 0.8;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, s * 0.96, s * 0.76);
        for (let k = 0; k < 2; k++) circle(ctx, x + s * (0.27 + k * 0.42), y - s * 0.06, s * 0.13, col);
      });
      break;
    }
    case 'bear': {
      circle(ctx, -r * 0.55, -r * 0.55, r * 0.32, ink);
      circle(ctx, r * 0.55, -r * 0.55, r * 0.32, ink);
      circle(ctx, 0, 0, r * 0.78, ink);
      circle(ctx, 0, r * 0.22, r * 0.34, a.window);
      circle(ctx, -r * 0.28, -r * 0.14, r * 0.09, '#222');
      circle(ctx, r * 0.28, -r * 0.14, r * 0.09, '#222');
      circle(ctx, 0, r * 0.12, r * 0.1, '#222');
      break;
    }
    case 'car': {
      ctx.fillStyle = ink;
      roundRect(ctx, -r * 0.95, -r * 0.1, r * 1.9, r * 0.55, r * 0.15);
      ctx.fill();
      roundRect(ctx, -r * 0.5, -r * 0.5, r * 1.0, r * 0.5, r * 0.15);
      ctx.fill();
      ctx.fillStyle = a.window;
      ctx.fillRect(-r * 0.38, -r * 0.4, r * 0.34, r * 0.3);
      ctx.fillRect(r * 0.04, -r * 0.4, r * 0.34, r * 0.3);
      circle(ctx, -r * 0.5, r * 0.45, r * 0.24, '#222');
      circle(ctx, r * 0.5, r * 0.45, r * 0.24, '#222');
      circle(ctx, -r * 0.5, r * 0.45, r * 0.1, '#ddd');
      circle(ctx, r * 0.5, r * 0.45, r * 0.1, '#ddd');
      break;
    }
    case 'board': {
      const s = r * 0.5;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        ctx.fillStyle = (i + j) % 2 ? ink : ink2;
        ctx.fillRect(-r * 0.75 + i * s, -r * 0.75 + j * s, s * 0.94, s * 0.94);
      }
      ctx.fillStyle = '#fff';
      roundRect(ctx, r * 0.2, r * 0.2, r * 0.6, r * 0.6, r * 0.1);
      ctx.fill();
      circle(ctx, r * 0.5, r * 0.5, r * 0.08, '#222');
      break;
    }
    case 'house': {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.05);
      ctx.lineTo(0, -r * 0.85);
      ctx.lineTo(r * 0.9, -r * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ink2;
      ctx.fillRect(-r * 0.65, -r * 0.05, r * 1.3, r * 0.85);
      ctx.fillStyle = '#e8506a';
      ctx.beginPath();
      ctx.moveTo(0, r * 0.62);
      ctx.bezierCurveTo(-r * 0.5, r * 0.25, -r * 0.25, -r * 0.15, 0, r * 0.12);
      ctx.bezierCurveTo(r * 0.25, -r * 0.15, r * 0.5, r * 0.25, 0, r * 0.62);
      ctx.fill();
      break;
    }
    case 'robot': {
      ctx.fillStyle = ink;
      ctx.fillRect(-r * 0.05, -r * 0.95, r * 0.1, r * 0.3);
      circle(ctx, 0, -r * 0.95, r * 0.12, ink2);
      roundRect(ctx, -r * 0.7, -r * 0.65, r * 1.4, r * 1.25, r * 0.2);
      ctx.fill();
      ctx.fillStyle = a.window;
      roundRect(ctx, -r * 0.52, -r * 0.45, r * 1.04, r * 0.5, r * 0.12);
      ctx.fill();
      circle(ctx, -r * 0.25, -r * 0.2, r * 0.13, ink2);
      circle(ctx, r * 0.25, -r * 0.2, r * 0.13, ink2);
      ctx.fillStyle = ink2;
      ctx.fillRect(-r * 0.35, r * 0.2, r * 0.7, r * 0.12);
      break;
    }
    case 'rattle': {
      ctx.fillStyle = ink;
      roundRect(ctx, -r * 0.1, 0, r * 0.2, r * 0.9, r * 0.1);
      ctx.fill();
      circle(ctx, 0, r * 0.9, r * 0.16, ink);
      circle(ctx, 0, -r * 0.3, r * 0.6, ink2);
      circle(ctx, -r * 0.2, -r * 0.48, r * 0.14, 'rgba(255,255,255,0.7)');
      break;
    }
    case 'ball': {
      circle(ctx, 0, 0, r * 0.85, ink);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.arc(-r * 0.9, 0, r * 0.9, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.9, 0, r * 0.9, Math.PI - 0.9, Math.PI + 0.9);
      ctx.stroke();
      break;
    }
    case 'crayon': {
      [ink, ink2, a.band].forEach((col, k) => {
        ctx.save();
        ctx.translate((k - 1) * r * 0.5, 0);
        ctx.rotate(0.35);
        ctx.fillStyle = col;
        ctx.fillRect(-r * 0.16, -r * 0.5, r * 0.32, r * 1.2);
        ctx.beginPath();
        ctx.moveTo(-r * 0.16, -r * 0.5);
        ctx.lineTo(0, -r * 0.9);
        ctx.lineTo(r * 0.16, -r * 0.5);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-r * 0.16, -r * 0.1, r * 0.32, r * 0.12);
        ctx.restore();
      });
      break;
    }
    case 'star': {
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? r * 0.38 : r * 0.9;
        const t = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
      }
      ctx.closePath();
      ctx.fill();
      circle(ctx, r * 0.62, -r * 0.6, r * 0.22, ink2);
      circle(ctx, -r * 0.7, r * 0.55, r * 0.16, ink2);
      break;
    }
  }
  ctx.restore();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch === ' ' ? '' : ch;
      if (lines.length === maxLines) return lines;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

// 1つの商品パッケージを (ox, oy) から一辺 s の正方形に描く
export function drawProduct(ctx, p, ox, oy, s) {
  const k = s / TILE;
  const a = p.art;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = a.bg;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = a.band;
  ctx.fillRect(0, 0, s, 22 * k);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${11 * k}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(p.maker, 6 * k, 11.5 * k);
  ctx.fillStyle = a.window;
  roundRect(ctx, 8 * k, 26 * k, s - 16 * k, 58 * k, 10 * k);
  ctx.fill();
  drawIcon(ctx, SECTIONS[p.section].icon, s / 2, 55 * k, 24 * k, a);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${14 * k}px ${FONT}`;
  ctx.textBaseline = 'top';
  wrapLines(ctx, p.name, s - 12 * k, 2).forEach((ln, i) => ctx.fillText(ln, 6 * k, (88 + i * 17) * k));
  ctx.restore();
}

// 売り場ひとつ分の商品を8x8に並べた1枚のテクスチャ用canvas
export function makeAtlas(products) {
  const c = document.createElement('canvas');
  c.width = c.height = TILE * ATLAS_GRID;
  const ctx = c.getContext('2d');
  for (let i = 0; i < PRODUCTS_PER_SECTION; i++) {
    drawProduct(ctx, products[i], (i % ATLAS_GRID) * TILE, Math.floor(i / ATLAS_GRID) * TILE, TILE);
  }
  return c;
}

export function makeSignCanvas(text, color, { width = 1024, height = 256, sub = '' } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, height * 0.82, width, height * 0.18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = height * (sub ? 0.46 : 0.56);
  ctx.font = `bold ${size}px ${FONT}`;
  while (ctx.measureText(text).width > width * 0.9) {
    size *= 0.92;
    ctx.font = `bold ${size}px ${FONT}`;
  }
  ctx.fillText(text, width / 2, height * (sub ? 0.38 : 0.44));
  if (sub) {
    ctx.font = `bold ${height * 0.17}px ${FONT}`;
    ctx.fillText(sub, width / 2, height * 0.7);
  }
  return c;
}
