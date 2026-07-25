// 迷霧效果：canvas 蓋在插圖上，依已讀比例挖洞散開
// 洞的順序用故事 id 做種子，重新整理後揭開位置一致

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COLS = 9, ROWS = 7;

export class Fog {
  constructor(canvas, seedStr) {
    this.canvas = canvas;
    this.seed = hashSeed(seedStr);
    this.revealed = 0;      // 目前已揭開的格數
    this.animCells = [];    // 動畫中的格 {idx, start}
    this.raf = 0;
    this._buildCells();
    this.resize();
  }

  _buildCells() {
    const rnd = mulberry32(this.seed);
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        cells.push({
          cx: (c + 0.5) / COLS + (rnd() - 0.5) * 0.06,
          cy: (r + 0.5) / ROWS + (rnd() - 0.5) * 0.06,
        });
      }
    }
    // 洗牌
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    this.cells = cells;
  }

  get total() { return this.cells.length; }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;
    this.draw(1);
  }

  /** ratio 0~1，換算要揭開幾格；有新格會做散開動畫 */
  setRatio(ratio) {
    const target = ratio >= 0.999 ? this.total : Math.floor(this.total * ratio);
    if (target > this.revealed) {
      const now = performance.now();
      for (let i = this.revealed; i < target; i++) {
        this.animCells.push({ idx: i, start: now });
      }
      this.revealed = target;
      this._animate();
    } else if (target < this.revealed) {
      this.revealed = target;
      this.animCells = [];
      this.draw(1);
    }
    this.canvas.style.opacity = this.revealed >= this.total ? '0' : '1';
    this.canvas.style.transition = 'opacity 1.2s ease';
  }

  _animate() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      const now = performance.now();
      this.animCells = this.animCells.filter((a) => now - a.start < 650);
      this.draw(1, now);
      if (this.animCells.length) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw(alpha = 1, now = performance.now()) {
    const ctx = this.canvas.getContext('2d');
    const { w, h, dpr } = this;
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = alpha;

    // --- 畫雲霧底 ---
    ctx.fillStyle = '#E7EDF5';
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry32(this.seed ^ 0x9E3779B9);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, y = rnd() * h;
      const r = (0.1 + rnd() * 0.16) * Math.max(w, h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tint = rnd() > 0.5 ? '255,255,255' : '208,220,235';
      g.addColorStop(0, `rgba(${tint},0.75)`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- 挖洞（已揭開的格） ---
    ctx.globalCompositeOperation = 'destination-out';
    const baseR = Math.max(w / COLS, h / ROWS) * 1.05;
    for (let i = 0; i < this.revealed; i++) {
      const cell = this.cells[i];
      const anim = this.animCells.find((a) => a.idx === i);
      let k = 1;
      if (anim) {
        const p = Math.min(1, (now - anim.start) / 650);
        k = 1 - Math.pow(1 - p, 3); // ease-out
      }
      const x = cell.cx * w, y = cell.cy * h, r = baseR * k;
      if (r <= 0) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.9)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}
