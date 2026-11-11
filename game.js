/* Cashy Bubbles
 * Cashy fires coins at the board. Three or more of a kind pop; anything left hanging drops.
 * Plain canvas, no libraries, no build step. The grid rules live in grid.js.
 * Game area is 706 x 720 so it drops straight into the same frame as the other Cashy games.
 */
(() => {
  "use strict";

  const Grid = window.CashyGrid;
  const EMPTY = Grid.EMPTY;

  // ───────────────────────── setup ─────────────────────────
  const W = 706;
  const H = 720;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  const COL = {
    ink: "#05070d",
    night: "#0b1330",
    dusk: "#141f52",
    blue: "#024ff6",
    blueLit: "#3b7bff",
    cyan: "#27e7ff",
    pink: "#ff2bd6",
    paper: "#f2f4f8",
    mist: "#aab4d4",
    note: "#a9dd8c",
  };
  const HEAD = "Cynatar, system-ui, sans-serif";
  const BODY = '"Noto Sans", system-ui, sans-serif';

  // The six coins. Each has its own mark as well as its colour, so they never rely on colour alone.
  const TYPES = [
    { base: "#024ff6", lit: "#6b98ff", dark: "#011f66", rim: "#9fbcff", mark: COL.paper, shape: "dot" },
    { base: "#19c9e6", lit: "#9af5ff", dark: "#06606f", rim: "#d2fcff", mark: COL.ink, shape: "diamond" },
    { base: "#ff2bd6", lit: "#ff9bec", dark: "#7d0a66", rim: "#ffc8f4", mark: COL.paper, shape: "star" },
    { base: "#7cc65e", lit: "#cdf2b8", dark: "#2a5f34", rim: "#e4f8d8", mark: "#163319", shape: "dollar" },
    { base: "#d3d9e8", lit: "#ffffff", dark: "#6f7a9c", rim: "#ffffff", mark: COL.ink, shape: "triangle" },
    { base: "#8a4dff", lit: "#c0a0ff", dark: "#33157a", rim: "#dccbff", mark: COL.paper, shape: "square" },
  ];

  // Board layout
  const COLS = 12;
  const ROWS = 12; // the last row is past the line: a coin there ends the run
  const DEATH_ROW = ROWS - 1;
  const R = 24;
  const D = R * 2;
  const ROW_H = R * Math.sqrt(3);
  const BOARD_L = (W - COLS * D) / 2;
  const BOARD_R = BOARD_L + COLS * D;
  const BOARD_T = 92;
  const LAUNCH = { x: W / 2, y: 636 };
  const GROUND_Y = 712;
  const cellX = (r, c) => BOARD_L + R + c * D + (Grid.shifted(grid, r) ? R : 0);
  const cellY = (r) => BOARD_T + R + r * ROW_H;
  const DEATH_Y = cellY(DEATH_ROW) - R;

  // Tuning
  const SHOT_SPEED = 1150;
  const AIM_SPEED = 1.7; // radians a second with the keys
  const AIM_MIN = 0.16;
  const AIM_MAX = Math.PI - 0.16;
  const HIT_DIST = D * 0.8; // a little forgiving, so shots slip past corners the way you expect
  const START_ROWS = 5;
  const LEVEL_EVERY = 1500;
  const POP_POINTS = 10;
  const CLEAR_BONUS = 2500;
  const colourCount = (level) => (level <= 2 ? 4 : level <= 4 ? 5 : 6);
  const shotsPerRow = (level) => Math.max(4, 9 - level);
  // The clock: a new row also comes on a timer, even if you never shoot. It starts slow and gets
  // half a second quicker with every level, down to a floor so it can never become impossible.
  const ROW_TIME_START = 30;
  const ROW_TIME_STEP = 0.5;
  const ROW_TIME_MIN = 5;
  const ROW_TIME_WARN = 5; // the bar turns pink and flashes in the last few seconds
  const rowTime = (level) => Math.max(ROW_TIME_MIN, ROW_TIME_START - ROW_TIME_STEP * (level - 1));

  // ───────────────────────── storage (always wrapped, it can throw) ─────────────────────────
  const store = {
    get(key, fallback) {
      try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, String(value));
      } catch {
        /* private window or blocked storage: carry on without it */
      }
    },
  };

  // Best five runs, saved on this device only. Score first, newest first on a tie.
  const RECORDS_KEPT = 5;
  function loadRecords() {
    let saved;
    try {
      saved = JSON.parse(store.get("cashy-bubbles-records", "[]"));
    } catch {
      saved = [];
    }
    if (!Array.isArray(saved)) return [];
    return saved
      .map((r) => ({ score: Number(r && r.score) || 0, level: Number(r && r.level) || 1, pops: Number(r && r.pops) || 0, t: Number(r && r.t) || 0 }))
      .slice(0, RECORDS_KEPT);
  }

  // ───────────────────────── images ─────────────────────────
  const img = {};
  function loadImage(name, src) {
    return new Promise((resolve) => {
      const i = new Image();
      i.onload = () => {
        img[name] = i;
        resolve();
      };
      i.onerror = () => resolve(); // game still runs without the art
      i.src = src;
    });
  }

  // ───────────────────────── sound ─────────────────────────
  let actx = null;
  let muted = store.get("cashy-bubbles-muted", "0") === "1";
  function audio() {
    if (!actx) {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (Ctor) actx = new Ctor();
      } catch {
        actx = null;
      }
    }
    if (actx && actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  function tone(freq, dur, type = "square", vol = 0.05, slideTo = null, delay = 0) {
    if (muted || !actx) return;
    const t0 = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  const sfx = {
    start() {
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.11, "square", 0.04, null, i * 0.08));
    },
    shoot() {
      tone(520, 0.09, "triangle", 0.05, 820);
    },
    bounce() {
      tone(900, 0.03, "square", 0.02);
    },
    stick() {
      tone(210, 0.07, "triangle", 0.05, 140);
    },
    pop(n) {
      for (let i = 0; i < Math.min(n, 7); i++) tone(620 + i * 95, 0.07, "square", 0.035, null, i * 0.04);
    },
    drop() {
      tone(760, 0.4, "sine", 0.05, 170);
    },
    push() {
      tone(120, 0.2, "sawtooth", 0.06, 70);
    },
    level() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.13, "square", 0.04, null, i * 0.1));
    },
    clear() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, "triangle", 0.05, null, i * 0.09));
    },
    over() {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, "sawtooth", 0.05, null, i * 0.2));
    },
  };

  const muteBtn = document.getElementById("mute");
  function syncMuteButton() {
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", muted ? "Sound off" : "Sound on");
  }
  function toggleMute() {
    muted = !muted;
    store.set("cashy-bubbles-muted", muted ? "1" : "0");
    syncMuteButton();
    if (!muted) {
      audio();
      tone(660, 0.08, "triangle", 0.05);
    }
  }
  muteBtn.addEventListener("click", () => {
    toggleMute();
    muteBtn.blur();
  });
  syncMuteButton();

  // ───────────────────────── random ─────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = (a, b) => a + Math.random() * (b - a);
  const rint = (n) => Math.floor(Math.random() * n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ───────────────────────── background ─────────────────────────
  // The sky and skyline never change, so they are painted once.
  const bg = document.createElement("canvas");
  bg.width = W * DPR;
  bg.height = H * DPR;
  (function paintBackground() {
    const c = bg.getContext("2d");
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.ink);
    g.addColorStop(0.62, COL.night);
    g.addColorStop(1, COL.dusk);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    const r = mulberry32(8453);
    let x = -10;
    while (x < W + 10) {
      const bw = 34 + Math.floor(r() * 46);
      const bh = 70 + Math.floor(r() * 150);
      const top = GROUND_Y + 2 - bh;
      c.fillStyle = r() < 0.5 ? "#0b1330" : "#0e1840";
      c.fillRect(x, top, bw, bh);
      for (let wy = top + 10; wy < GROUND_Y - 8; wy += 14) {
        for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
          const roll = r();
          if (roll < 0.16) {
            c.fillStyle = "#1c2f7a";
            c.fillRect(wx, wy, 5, 7);
          } else if (roll < 0.19) {
            c.fillStyle = "#27e7ff";
            c.globalAlpha = 0.45;
            c.fillRect(wx, wy, 5, 7);
            c.globalAlpha = 1;
          }
        }
      }
      x += bw + 3 + Math.floor(r() * 8);
    }
    const fade = c.createLinearGradient(0, GROUND_Y - 120, 0, H);
    fade.addColorStop(0, "rgba(5,7,13,0)");
    fade.addColorStop(1, "rgba(5,7,13,0.78)");
    c.fillStyle = fade;
    c.fillRect(0, GROUND_Y - 120, W, H - (GROUND_Y - 120));

    // the board: a darker glass panel so the coins read clearly over the city
    c.fillStyle = "rgba(5,7,13,0.62)";
    c.fillRect(BOARD_L - 4, BOARD_T - 4, BOARD_R - BOARD_L + 8, DEATH_Y - BOARD_T + 4);
  })();

  const stars = Array.from({ length: 50 }, (_, i) => {
    const r = mulberry32(i * 97 + 3);
    const left = r() < 0.5;
    return { x: left ? r() * (BOARD_L - 8) : BOARD_R + 8 + r() * (W - BOARD_R - 8), y: 90 + r() * 420, s: 0.6 + r() * 1.4, p: r() * 6.28, sp: 0.6 + r() * 1.6 };
  });

  // ───────────────────────── coin sprites ─────────────────────────
  // Each coin is drawn once to its own little canvas, then stamped; a full board is 130 coins.
  const SPRITE = D + 6;
  const sprites = [];
  function markPath(c, shape, x, y) {
    c.beginPath();
    if (shape === "dot") {
      c.arc(x, y, 6.5, 0, 6.28);
    } else if (shape === "diamond") {
      c.moveTo(x, y - 9);
      c.lineTo(x + 7.5, y);
      c.lineTo(x, y + 9);
      c.lineTo(x - 7.5, y);
      c.closePath();
    } else if (shape === "star") {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 4 : 9.5;
        c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      c.closePath();
    } else if (shape === "triangle") {
      c.moveTo(x, y - 8.5);
      c.lineTo(x + 8.5, y + 6.5);
      c.lineTo(x - 8.5, y + 6.5);
      c.closePath();
    } else if (shape === "square") {
      c.rect(x - 6.5, y - 6.5, 13, 13);
    }
  }
  function makeSprites() {
    TYPES.forEach((t, i) => {
      const s = document.createElement("canvas");
      s.width = s.height = SPRITE * DPR;
      const c = s.getContext("2d");
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      const m = SPRITE / 2;
      const g = c.createRadialGradient(m - 8, m - 9, 2, m, m, R);
      g.addColorStop(0, t.lit);
      g.addColorStop(0.55, t.base);
      g.addColorStop(1, t.dark);
      c.fillStyle = g;
      c.beginPath();
      c.arc(m, m, R - 1.5, 0, 6.28);
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = t.rim;
      c.stroke();
      c.globalAlpha = 0.35;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(m, m, R - 6.5, 0, 6.28);
      c.stroke();
      c.globalAlpha = 0.4;
      c.fillStyle = "#fff";
      c.beginPath();
      c.ellipse(m - 8, m - 11, 6, 3.4, -0.6, 0, 6.28);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = t.mark;
      if (t.shape === "dollar") {
        c.font = `700 22px ${BODY}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("$", m, m + 1);
      } else {
        markPath(c, t.shape, m, m);
        c.fill();
      }
      sprites[i] = s;
    });
  }
  function drawCoin(type, x, y, scale = 1, alpha = 1) {
    const s = SPRITE * scale;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(sprites[type], x - s / 2, y - s / 2, s, s);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  // ───────────────────────── game state ─────────────────────────
  const G = {
    state: "title", // title | play | pause | over | records
    t: 0,
    score: 0,
    best: Number(store.get("cashy-bubbles-best", "0")) || 0,
    newBest: false,
    level: 1,
    nextLevelAt: LEVEL_EVERY, // score needed for the next level, counted from the last level-up
    pops: 0, // coins popped or dropped this run
    shotsLeft: shotsPerRow(1), // shots until a new row pushes in
    timer: rowTime(1), // seconds until a new row pushes in on its own
    slide: 0, // 1 → 0 while a new row slides in
    buffer: 0, // a fire press held for a moment, in case a shot is still flying
    banner: null,
    shake: 0,
    overT: 0,
    overReason: "",
    menu: 0, // 0 = play, 1 = check records
    back: "title", // where the Records screen returns to
    records: loadRecords(),
    lastRunT: 0, // when the run that just ended finished, so Records can highlight it
  };

  let grid = Grid.create(ROWS, COLS);
  const aim = { a: Math.PI / 2 };
  let shot = null;
  let current = 0;
  let next = 0;
  let throwT = 0;
  let pops = []; // coins shrinking away
  let falls = []; // coins dropping off the board
  let particles = [];
  let popups = [];
  let notes = []; // the level-up cash and confetti: for show only, they never touch the board

  // ───────────────────────── board ─────────────────────────
  // Neighbours in a row often share a colour, which gives the board clumps worth aiming at.
  function randomRow(len, n) {
    const row = [];
    for (let c = 0; c < len; c++) row.push(c > 0 && Math.random() < 0.4 ? row[c - 1] : rint(n));
    return row;
  }
  function fillBoard(rows) {
    grid = Grid.create(ROWS, COLS);
    const n = colourCount(G.level);
    for (let r = 0; r < rows; r++) {
      const row = randomRow(Grid.rowLen(grid, r), n);
      row.forEach((t, c) => (grid.cells[r][c] = t));
    }
  }
  // Cashy is only handed colours still on the board.
  function pick() {
    const left = [...Grid.typesLeft(grid)];
    return left.length ? left[rint(left.length)] : rint(colourCount(G.level));
  }
  function nearestFreeCell(x, y) {
    let best = null;
    let bestD = Infinity;
    for (let r = 0; r < ROWS; r++) {
      const cy = cellY(r);
      if (Math.abs(cy - y) > ROW_H * 1.6) continue;
      for (let c = 0; c < Grid.rowLen(grid, r); c++) {
        if (grid.cells[r][c] !== EMPTY) continue;
        const held = r === 0 || Grid.neighbours(grid, r, c).some(([nr, nc]) => grid.cells[nr][nc] !== EMPTY);
        if (!held) continue;
        const d = Math.hypot(cellX(r, c) - x, cy - y);
        if (d < bestD) {
          bestD = d;
          best = [r, c];
        }
      }
    }
    return best;
  }
  function hitsCoin(x, y) {
    if (y <= BOARD_T + R) return true;
    for (let r = 0; r < ROWS; r++) {
      const cy = cellY(r);
      if (Math.abs(cy - y) > HIT_DIST) continue;
      for (let c = 0; c < Grid.rowLen(grid, r); c++) {
        if (grid.cells[r][c] !== EMPTY && Math.hypot(cellX(r, c) - x, cy - y) < HIT_DIST) return true;
      }
    }
    return false;
  }

  // ───────────────────────── start / end ─────────────────────────
  function startGame() {
    G.score = 0;
    G.pops = 0;
    G.level = 1;
    G.nextLevelAt = LEVEL_EVERY;
    G.menu = 0;
    G.newBest = false;
    G.shotsLeft = shotsPerRow(1);
    G.timer = rowTime(1);
    G.slide = 0;
    G.buffer = 0;
    G.banner = null;
    G.shake = 0;
    aim.a = Math.PI / 2;
    shot = null;
    pops = [];
    falls = [];
    particles = [];
    popups = [];
    notes = [];
    fillBoard(START_ROWS);
    current = pick();
    next = pick();
    G.state = "play";
    sfx.start();
  }

  function gameOver(reason) {
    G.state = "over";
    G.overT = 0;
    G.overReason = reason;
    G.shake = 10;
    shot = null;
    if (G.score > G.best) {
      G.best = G.score;
      G.newBest = true;
      store.set("cashy-bubbles-best", G.best);
    }
    G.menu = 0;
    if (G.score > 0) {
      G.lastRunT = Date.now();
      G.records = [...G.records, { score: G.score, level: G.level, pops: G.pops, t: G.lastRunT }].sort((a, b) => b.score - a.score || b.t - a.t).slice(0, RECORDS_KEPT);
      store.set("cashy-bubbles-records", JSON.stringify(G.records));
    }
    sfx.over();
  }

  // ───────────────────────── shooting ─────────────────────────
  function fire() {
    if (shot || G.slide > 0) return false;
    shot = { x: LAUNCH.x, y: LAUNCH.y, vx: Math.cos(aim.a) * SHOT_SPEED, vy: -Math.sin(aim.a) * SHOT_SPEED, type: current };
    current = next;
    next = pick();
    throwT = 0.25;
    sfx.shoot();
    return true;
  }

  function moveShot(dt) {
    const steps = Math.ceil((SHOT_SPEED * dt) / (R * 0.4));
    for (let i = 0; i < steps; i++) {
      shot.x += (shot.vx * dt) / steps;
      shot.y += (shot.vy * dt) / steps;
      if (shot.x < BOARD_L + R) {
        shot.x = 2 * (BOARD_L + R) - shot.x;
        shot.vx = Math.abs(shot.vx);
        sfx.bounce();
      } else if (shot.x > BOARD_R - R) {
        shot.x = 2 * (BOARD_R - R) - shot.x;
        shot.vx = -Math.abs(shot.vx);
        sfx.bounce();
      }
      if (hitsCoin(shot.x, shot.y)) {
        land();
        return;
      }
    }
  }

  function land() {
    const cell = nearestFreeCell(shot.x, shot.y);
    const type = shot.type;
    shot = null;
    if (!cell) return; // shouldn't happen; the coin is simply lost rather than breaking the board
    const [r, c] = cell;
    grid.cells[r][c] = type;
    resolve(r, c);
  }

  function addScore(n, x, y, colour) {
    G.score += n;
    popup(x, y, "+" + n, colour);
    // One level at a time, however big the score jump: a long drop can be worth thousands.
    if (G.score >= G.nextLevelAt) {
      G.level++;
      G.nextLevelAt = G.score + LEVEL_EVERY;
      G.timer = Math.min(G.timer, rowTime(G.level));
      G.banner = { title: "LEVEL " + G.level, sub: colourCount(G.level) > colourCount(G.level - 1) ? "A new coin joins the board" : "The clock runs quicker now", t: 1.6 };
      sfx.level();
      celebrate();
    }
  }

  // A new row slides in from the top, whether the shots or the clock asked for it. Both start over.
  function pushNewRow() {
    Grid.pushRow(grid, randomRow(COLS, colourCount(G.level)));
    G.shotsLeft = shotsPerRow(G.level);
    G.timer = rowTime(G.level);
    G.slide = 1;
    G.shake = Math.max(G.shake, 3);
    sfx.push();
  }

  function resolve(r, c) {
    const group = Grid.matchGroup(grid, r, c);
    if (group.length >= 3) {
      let sx = 0;
      let sy = 0;
      for (const [gr, gc] of group) {
        const x = cellX(gr, gc);
        const y = cellY(gr);
        pops.push({ x, y, type: grid.cells[gr][gc], t: 0 });
        burst(x, y, TYPES[grid.cells[gr][gc]].base, 6);
        grid.cells[gr][gc] = EMPTY;
        sx += x;
        sy += y;
      }
      G.pops += group.length;
      sfx.pop(group.length);
      addScore(POP_POINTS * group.length, sx / group.length, sy / group.length, COL.paper);

      const loose = Grid.floaters(grid);
      if (loose.length) {
        let fx = 0;
        let fy = 0;
        for (const [fr, fc] of loose) {
          const x = cellX(fr, fc);
          const y = cellY(fr);
          falls.push({ x, y, vx: rand(-60, 60), vy: rand(-160, -40), type: grid.cells[fr][fc], rot: 0, spin: rand(-6, 6) });
          grid.cells[fr][fc] = EMPTY;
          fx += x;
          fy += y;
        }
        G.pops += loose.length;
        G.shake = Math.max(G.shake, 4);
        sfx.drop();
        // Drops double with every coin, which is where the big scores are.
        addScore(POP_POINTS * 2 ** Math.min(loose.length, 10), fx / loose.length, fy / loose.length + 26, COL.cyan);
      }
    } else {
      sfx.stick();
    }

    if (Grid.lowestRow(grid) === -1) {
      addScore(CLEAR_BONUS, W / 2, 300, COL.cyan);
      G.banner = { title: "BOARD CLEARED", sub: "+" + CLEAR_BONUS.toLocaleString("en-GB") + " bonus", t: 1.8 };
      sfx.clear();
      fillBoard(START_ROWS);
      G.shotsLeft = shotsPerRow(G.level);
      G.timer = rowTime(G.level);
      G.slide = 1;
    } else if (--G.shotsLeft <= 0) pushNewRow();

    if (Grid.lowestRow(grid) >= DEATH_ROW) {
      gameOver("The coins reached the street.");
      return;
    }
    // A colour may have just left the board; never keep one Cashy can't match.
    const left = Grid.typesLeft(grid);
    if (!left.has(current)) current = pick();
    if (!left.has(next)) next = pick();
  }

  // ───────────────────────── input ─────────────────────────
  const keys = new Set();
  const normKey = (k) => (k === " " || k === "Spacebar" ? "space" : k.toLowerCase());
  let pointerAiming = false; // a press that started during play, so letting go fires

  function primary() {
    // Space / Enter / tap on the menus
    audio();
    if (G.state === "records") G.state = G.back;
    else if (G.state === "title" || (G.state === "over" && G.overT > 0.8)) {
      if (G.menu === 1) {
        G.back = G.state;
        G.state = "records";
      } else startGame();
    } else if (G.state === "pause") G.state = "play";
  }
  function togglePause() {
    if (G.state === "play") G.state = "pause";
    else if (G.state === "pause") G.state = "play";
    else if (G.state === "records") G.state = G.back;
  }

  // The two buttons on the title and game over screens. Their rows on the canvas, for taps.
  const MENU_ROWS = { title: [652, 680], over: [556, 590] };
  const menuLabels = () => [G.state === "over" ? "PLAY AGAIN" : "PLAY", "CHECK RECORDS"];

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = normKey(e.key);
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "space"].includes(k)) e.preventDefault();
    const fresh = !keys.has(k);
    keys.add(k);
    if (!fresh) return;
    if (G.state === "play") {
      if (k === "space" || k === "arrowup" || k === "w" || k === "enter") G.buffer = 0.15;
      else if (k === "p" || k === "escape") togglePause();
      else if (k === "m") toggleMute();
      return;
    }
    if ((G.state === "title" || G.state === "over") && ["arrowup", "w", "arrowdown", "s"].includes(k)) {
      G.menu = 1 - G.menu;
      audio();
      return;
    }
    if (k === "space" || k === "enter") primary();
    else if (k === "p" || k === "escape") togglePause();
    else if (k === "m") toggleMute();
    else audio();
  });
  window.addEventListener("keyup", (e) => keys.delete(normKey(e.key)));

  function releaseAll() {
    keys.clear();
    pointerAiming = false;
  }
  window.addEventListener("blur", () => {
    releaseAll();
    if (G.state === "play") G.state = "pause";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      releaseAll();
      if (G.state === "play") G.state = "pause";
    }
  });

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height };
  }
  function aimAt(p) {
    // Pointing below the launcher still aims sensibly: it clamps to the nearest side.
    const a = Math.atan2(LAUNCH.y - p.y, p.x - LAUNCH.x);
    aim.a = a < -Math.PI / 2 ? AIM_MAX : clamp(a, AIM_MIN, AIM_MAX);
  }

  canvas.addEventListener("pointerdown", (e) => {
    audio();
    const p = canvasPoint(e);
    if (G.state === "play") {
      pointerAiming = true;
      aimAt(p);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* older browsers: the drag still works while over the canvas */
      }
    } else if (G.state === "title" || G.state === "over") {
      // Tapping the Records button opens it; tapping anywhere else plays.
      G.menu = Math.abs(p.y - MENU_ROWS[G.state][1]) < 18 ? 1 : 0;
      primary();
    } else if (G.state === "pause" || G.state === "records") primary();
  });
  canvas.addEventListener("pointermove", (e) => {
    // A mouse aims just by hovering; a finger aims while it's down.
    if (G.state === "play" && (pointerAiming || e.pointerType === "mouse")) aimAt(canvasPoint(e));
  });
  canvas.addEventListener("pointerup", (e) => {
    if (G.state === "play" && pointerAiming) {
      aimAt(canvasPoint(e));
      G.buffer = 0.15;
    }
    pointerAiming = false;
  });
  canvas.addEventListener("pointercancel", () => (pointerAiming = false));

  const wantsLeft = () => keys.has("arrowleft") || keys.has("a");
  const wantsRight = () => keys.has("arrowright") || keys.has("d");

  // ───────────────────────── effects ─────────────────────────
  const CONFETTI = [COL.cyan, COL.pink, COL.note, COL.paper, COL.blueLit, "#8a4dff", "#ff7a45"];

  // Level up: cash bursts from the middle and rains from the top, and two cannons fire confetti
  // from the bottom corners, like Cashy Tower. All screen space and purely for show.
  function celebrate() {
    const k = reduceMotion ? 0.35 : 1;
    const burst = Math.round(46 * k);
    const rain = Math.round(34 * k);
    for (let i = 0; i < burst + rain; i++) {
      const raining = i >= burst;
      const angle = rand(0, Math.PI * 2);
      const speed = rand(260, 780);
      notes.push({
        kind: "cash",
        x: raining ? rand(0, W) : W / 2,
        y: raining ? rand(-190, -30) : 340,
        vx: raining ? rand(-70, 70) : Math.cos(angle) * speed,
        vy: raining ? rand(80, 280) : Math.sin(angle) * speed - 340,
        rot: rand(0, 6.28),
        spin: rand(-4.5, 4.5),
        scale: rand(1.1, 2),
        age: 0,
        life: raining ? 3.4 : rand(2.2, 3),
      });
    }
    const confetti = Math.round(150 * k);
    for (let i = 0; i < confetti; i++) {
      const fromCannon = i < confetti * 0.65;
      const left = i % 2 === 0;
      const angle = (left ? -1.05 : -Math.PI + 1.05) + rand(-0.45, 0.45);
      const speed = rand(700, 1600);
      notes.push({
        kind: "confetti",
        x: fromCannon ? (left ? 30 : W - 30) : rand(0, W),
        y: fromCannon ? H - 20 : rand(-200, -20),
        vx: fromCannon ? Math.cos(angle) * speed : rand(-80, 80),
        vy: fromCannon ? Math.sin(angle) * speed : rand(40, 160),
        rot: rand(0, 6.28),
        spin: rand(-6, 6),
        age: 0,
        life: fromCannon ? rand(3.2, 4.8) : rand(4.2, 5.4),
        colour: CONFETTI[rint(CONFETTI.length)],
        w: rand(9, 18),
        h: rand(5, 10),
        round: Math.random() < 0.22,
        flip: rand(0, 6.28),
        flipSpeed: rand(6, 16),
      });
    }
  }

  function burst(x, y, colour, n = 10) {
    if (reduceMotion) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(80, 260);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), rot: rand(0, 6), spin: rand(-8, 8), w: rand(3, 6), h: rand(3, 6), col: colour });
    }
  }
  function popup(x, y, text, colour = COL.paper) {
    popups.push({ x, y, text, col: colour, life: 1 });
  }

  function updateFx(dt) {
    for (const p of pops) p.t += dt;
    pops = pops.filter((p) => p.t < 0.18);
    for (const f of falls) {
      f.vy += 1500 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
    }
    falls = falls.filter((f) => f.y < H + 40);
    for (const p of particles) {
      p.vy += 500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) {
      p.y -= 40 * dt;
      p.life -= dt;
    }
    popups = popups.filter((p) => p.life > 0);
    for (const n of notes) {
      n.age += dt;
      if (n.kind === "confetti") {
        // Paper: air drags it to a slow flutter, so it hangs about instead of dropping like cash.
        const drag = 1 - Math.min(1, dt * 1.9);
        n.vx *= drag;
        n.vy = n.vy * drag + 330 * dt;
        n.flip += n.flipSpeed * dt;
      } else {
        n.vy += 900 * dt;
        n.vx *= 1 - Math.min(1, dt * 0.8);
      }
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.rot += n.spin * dt;
    }
    notes = notes.filter((n) => n.age < n.life && n.y < H + 40 && n.y > -300);
    G.shake = Math.max(0, G.shake - 30 * dt);
  }

  function updatePlay(dt) {
    if (G.slide > 0) G.slide = Math.max(0, G.slide - dt / 0.3);
    if (G.banner && (G.banner.t -= dt) <= 0) G.banner = null;
    throwT = Math.max(0, throwT - dt);
    const turn = (wantsRight() ? 1 : 0) - (wantsLeft() ? 1 : 0);
    if (turn) aim.a = clamp(aim.a - turn * AIM_SPEED * dt, AIM_MIN, AIM_MAX);
    if (G.buffer > 0) {
      if (fire()) G.buffer = 0;
      else G.buffer -= dt;
    }
    if (shot) moveShot(dt);
    // The clock waits while a shot is flying or a row is sliding in, so a row never lands mid-shot.
    else if (G.slide === 0 && G.state === "play") {
      G.timer -= dt;
      if (G.timer <= 0) {
        pushNewRow();
        if (Grid.lowestRow(grid) >= DEATH_ROW) gameOver("Time ran out and the coins reached the street.");
      }
    }
  }

  function update(dt) {
    G.t += dt;
    if (G.state === "pause") return;
    updateFx(dt);
    if (G.state === "play") updatePlay(dt);
    else if (G.state === "over") G.overT += dt;
  }

  // ───────────────────────── drawing helpers ─────────────────────────
  function text(str, x, y, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || ""} ${o.size || 16}px ${o.font || BODY}`.trim();
    ctx.textAlign = o.align || "left";
    ctx.textBaseline = o.base || "alphabetic";
    if (o.glow) {
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = o.blur || 18;
    }
    if (o.stroke) {
      ctx.lineWidth = o.strokeW || 6;
      ctx.strokeStyle = o.stroke;
      ctx.lineJoin = "round";
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.color || COL.paper;
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function glowLine(x1, y1, x2, y2, colour = COL.blue, width = 3) {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.shadowColor = colour;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBill(x, y, rot, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.fillStyle = COL.note;
    ctx.strokeStyle = "#2f5a24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-13, -7, 26, 14, 2);
    else ctx.rect(-13, -7, 26, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1d3a16";
    ctx.font = `700 10px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 0, 0.5);
    ctx.restore();
  }

  // Fades out over the last half second of each piece's life.
  function drawNotes() {
    for (const n of notes) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (n.life - n.age) / 0.5));
      if (n.kind === "cash") {
        drawBill(n.x, n.y, n.rot, n.scale);
        continue;
      }
      // Confetti tumbles: its width shrinks to a sliver and back as it flips over.
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(n.rot);
      ctx.scale(Math.cos(n.flip), 1);
      ctx.fillStyle = n.colour;
      if (n.round) {
        ctx.beginPath();
        ctx.arc(0, 0, n.h / 2 + 1, 0, 6.28);
        ctx.fill();
      } else ctx.fillRect(-n.w / 2, -n.h / 2, n.w, n.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawBoard() {
    const slideY = -G.slide * ROW_H;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < Grid.rowLen(grid, r); c++) {
        const t = grid.cells[r][c];
        if (t !== EMPTY) drawCoin(t, cellX(r, c), cellY(r) + slideY);
      }
    }
  }

  // The dotted line shows where the shot will go, bounces included, up to the first coin it meets.
  function drawGuide() {
    let x = LAUNCH.x;
    let y = LAUNCH.y;
    let vx = Math.cos(aim.a);
    let vy = -Math.sin(aim.a);
    const step = 6;
    ctx.save();
    ctx.fillStyle = TYPES[current].lit;
    for (let i = 0; i < 160; i++) {
      x += vx * step;
      y += vy * step;
      if (x < BOARD_L + R) {
        x = 2 * (BOARD_L + R) - x;
        vx = -vx;
      } else if (x > BOARD_R - R) {
        x = 2 * (BOARD_R - R) - x;
        vx = -vx;
      }
      if (hitsCoin(x, y)) break;
      if (i % 3 === 0 && i > 6) {
        ctx.globalAlpha = Math.max(0.15, 0.75 - i / 220);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, 6.28);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawLauncher() {
    // barrel
    ctx.save();
    ctx.translate(LAUNCH.x, LAUNCH.y);
    ctx.rotate(-aim.a);
    ctx.fillStyle = COL.blue;
    ctx.strokeStyle = COL.blueLit;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(16, -10, 52, 20, 6);
    else ctx.rect(16, -10, 52, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COL.cyan;
    ctx.fillRect(60, -10, 4, 20);
    ctx.restore();
    // base ring with the loaded coin in it
    ctx.save();
    ctx.fillStyle = COL.night;
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 3;
    ctx.shadowColor = COL.blue;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(LAUNCH.x, LAUNCH.y, R + 8, 0, 6.28);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (G.slide === 0 || shot) drawCoin(current, LAUNCH.x, LAUNCH.y);
    else drawCoin(current, LAUNCH.x, LAUNCH.y, 1 - G.slide * 0.5);

    // next coin
    const nx = LAUNCH.x + 118;
    const ny = LAUNCH.y + 22;
    text("NEXT", nx, ny - 32, { size: 11, weight: 700, color: COL.mist, align: "center" });
    drawCoin(next, nx, ny, 0.8);

    // shots until a new row: a dot each, the last one pulses pink
    const n = shotsPerRow(G.level);
    const gap = 15;
    const x0 = LAUNCH.x - ((n - 1) * gap) / 2;
    const dy = LAUNCH.y + R + 28;
    for (let i = 0; i < n; i++) {
      const on = i < G.shotsLeft;
      const warn = G.shotsLeft === 1 && on;
      ctx.beginPath();
      ctx.arc(x0 + i * gap, dy, 4.5, 0, 6.28);
      if (on) {
        ctx.fillStyle = warn ? COL.pink : COL.cyan;
        ctx.globalAlpha = warn && !reduceMotion ? 0.55 + 0.45 * Math.abs(Math.sin(G.t * 7)) : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = "rgba(170,180,212,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    text("SHOTS TO NEW ROW", x0 + (n - 1) * gap + 14, dy + 4, { size: 10, weight: 700, color: COL.mist });
  }

  function drawCashy() {
    const x = LAUNCH.x - 150;
    if (throwT > 0 && img.crouch) {
      const s = 128;
      ctx.drawImage(img.crouch, x - s / 2 + 6, GROUND_Y + 5 - s, s, s);
    } else if (img.cashy) {
      const h = 120;
      const w = (h * img.cashy.width) / img.cashy.height;
      const bob = reduceMotion ? 0 : Math.sin(G.t * 2.4) * 1.5;
      ctx.drawImage(img.cashy, x - w / 2, GROUND_Y - h + bob, w, h);
    }
  }

  function drawHud() {
    text("SCORE", 22, 26, { size: 11, weight: 700, color: COL.mist });
    text(String(G.score).padStart(5, "0"), 22, 54, { size: 30, weight: 700, color: COL.paper });
    text("BEST " + String(G.best).padStart(5, "0"), 22, 74, { size: 11, weight: 700, color: COL.mist });
    text("LEVEL", W / 2, 26, { size: 11, weight: 700, color: COL.mist, align: "center" });
    text(String(G.level), W / 2, 54, { size: 30, weight: 700, color: COL.cyan, align: "center" });
    // The clock: a bar along the top of the board that drains, with the seconds under the level.
    const left = Math.max(0, G.timer);
    const warn = left <= ROW_TIME_WARN;
    const pulse = warn && !reduceMotion ? 0.55 + 0.45 * Math.abs(Math.sin(G.t * 8)) : 1;
    const barX = BOARD_L - 4;
    const barW = BOARD_R - BOARD_L + 8;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(barX, 79, barW, 4);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = warn ? COL.pink : COL.cyan;
    ctx.fillRect(barX, 79, barW * Math.min(1, left / rowTime(G.level)), 4);
    ctx.globalAlpha = 1;
    text("NEW ROW IN " + Math.ceil(left) + "s", W / 2, 74, { size: 11, weight: 700, color: warn ? COL.pink : COL.mist, align: "center" });
  }

  function overlay(alpha = 0.72) {
    ctx.fillStyle = `rgba(5,7,13,${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawMenu(rows) {
    menuLabels().forEach((label, i) => {
      const chosen = i === G.menu;
      text(chosen ? "›  " + label + "  ‹" : label, W / 2, rows[i], { size: 17, weight: 700, color: chosen ? COL.cyan : COL.mist, align: "center", glow: chosen ? COL.cyan : undefined, blur: 12 });
    });
  }

  function titleScreen() {
    overlay(0.8);
    text("CASHY", W / 2, 158, { size: 104, font: HEAD, align: "center", stroke: COL.ink, strokeW: 14, glow: COL.blue, blur: 30 });
    text("BUBBLES", W / 2, 232, { size: 62, font: HEAD, color: COL.cyan, align: "center", stroke: COL.ink, strokeW: 10, glow: COL.cyan, blur: 20 });
    if (img.cashy) {
      const h = 330;
      const w = (h * img.cashy.width) / img.cashy.height;
      const bob = reduceMotion ? 0 : Math.sin(G.t * 2) * 4;
      ctx.drawImage(img.cashy, W / 2 - w / 2, 268 + bob, w, h);
    }
    text("Match three coins to pop them.", W / 2, 622, { size: 18, weight: 700, align: "center" });
    drawMenu(MENU_ROWS.title);
    const hint = coarse ? "Drag to aim  ·  let go to fire" : "← → or mouse aim  ·  Space or click fire  ·  ↑ ↓ menu  ·  P pause";
    text(hint, W / 2, 708, { size: 12, color: COL.mist, align: "center" });
  }

  function recordsScreen() {
    overlay(0.86);
    text("RECORDS", W / 2, 112, { size: 76, font: HEAD, align: "center", stroke: COL.ink, strokeW: 12, glow: COL.blue, blur: 26 });
    text("Your best five runs, saved on this device", W / 2, 152, { size: 15, color: COL.mist, align: "center" });
    const cols = { rank: 72, score: 118, level: 290, pops: 380, when: 480 };
    const head = { size: 11, weight: 700, color: COL.mist };
    text("#", cols.rank, 200, head);
    text("SCORE", cols.score, 200, head);
    text("LEVEL", cols.level, 200, head);
    text("COINS", cols.pops, 200, head);
    text("WHEN", cols.when, 200, head);
    if (G.records.length === 0) text("No runs yet. Go pop some coins.", W / 2, 306, { size: 18, color: COL.mist, align: "center" });
    G.records.forEach((r, i) => {
      const y = 236 + i * 58;
      const latest = r.t === G.lastRunT && r.t !== 0;
      ctx.save();
      ctx.fillStyle = latest ? "rgba(39,231,255,0.14)" : "rgba(255,255,255,0.06)";
      ctx.strokeStyle = latest ? COL.cyan : "rgba(255,255,255,0.1)";
      ctx.lineWidth = latest ? 2 : 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(44, y - 24, W - 88, 48, 12);
      else ctx.rect(44, y - 24, W - 88, 48);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const num = { size: 20, weight: 700, base: "middle", color: COL.paper };
      text(String(i + 1), cols.rank, y, { ...num, color: latest ? COL.cyan : COL.mist });
      text(r.score.toLocaleString("en-GB"), cols.score, y, num);
      text(String(r.level), cols.level, y, num);
      text(String(r.pops), cols.pops, y, num);
      const when = r.t ? new Date(r.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Earlier";
      text(when, cols.when, y, { size: 14, base: "middle", color: COL.mist });
    });
    text("ESC, SPACE OR TAP TO GO BACK", W / 2, 640, { size: 13, weight: 700, color: COL.cyan, align: "center" });
  }

  function pauseScreen() {
    overlay(0.7);
    text("PAUSED", W / 2, H / 2 - 6, { size: 72, font: HEAD, align: "center", stroke: COL.ink, strokeW: 12, glow: COL.blue });
    text("Press P, Space or tap to carry on", W / 2, H / 2 + 38, { size: 17, weight: 700, color: COL.cyan, align: "center" });
  }

  function overScreen() {
    overlay(0.78);
    text("GAME OVER", W / 2, 268, { size: 84, font: HEAD, align: "center", stroke: COL.ink, strokeW: 12, glow: COL.blue, blur: 28 });
    text(G.overReason, W / 2, 308, { size: 17, color: COL.mist, align: "center" });
    text("SCORE", W / 2, 372, { size: 13, weight: 700, color: COL.mist, align: "center" });
    text(String(G.score), W / 2, 424, { size: 58, weight: 700, color: COL.paper, align: "center" });
    text(G.newBest ? "NEW BEST!" : "BEST " + G.best, W / 2, 458, { size: 18, weight: 700, color: G.newBest ? COL.cyan : COL.mist, align: "center" });
    text("Reached level " + G.level + "  ·  " + G.pops + " coins popped", W / 2, 486, { size: 16, color: COL.mist, align: "center" });
    if (G.overT > 0.8) {
      drawMenu(MENU_ROWS.over);
      text("↑ ↓ to choose  ·  Space to pick  ·  or tap", W / 2, 626, { size: 12, color: COL.mist, align: "center" });
    }
  }

  function banners() {
    if (G.state !== "play" || !G.banner) return;
    const a = Math.min(1, G.banner.t * 2);
    text(G.banner.title, W / 2, 330, { size: 58, font: HEAD, align: "center", stroke: COL.ink, strokeW: 10, glow: COL.cyan, blur: 22, alpha: a });
    text(G.banner.sub, W / 2, 370, { size: 20, weight: 700, color: COL.cyan, align: "center", stroke: COL.ink, strokeW: 5, alpha: a });
  }

  // ───────────────────────── draw ─────────────────────────
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(bg, 0, 0, W, H);

    ctx.fillStyle = COL.paper;
    for (const s of stars) {
      ctx.globalAlpha = reduceMotion ? 0.5 : 0.3 + 0.5 * Math.abs(Math.sin(G.t * s.sp + s.p));
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    if (G.shake > 0 && !reduceMotion) ctx.translate(rand(-1, 1) * G.shake * 0.5, rand(-1, 1) * G.shake * 0.5);

    // walls, ceiling and the line the coins must not cross
    glowLine(BOARD_L - 4, BOARD_T - 4, BOARD_R + 4, BOARD_T - 4);
    glowLine(BOARD_L - 4, BOARD_T - 4, BOARD_L - 4, LAUNCH.y + 40);
    glowLine(BOARD_R + 4, BOARD_T - 4, BOARD_R + 4, LAUNCH.y + 40);
    const danger = G.state === "play" && Grid.lowestRow(grid) >= DEATH_ROW - 2;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = danger ? COL.pink : "rgba(170,180,212,0.35)";
    ctx.globalAlpha = danger && !reduceMotion ? 0.5 + 0.5 * Math.abs(Math.sin(G.t * 6)) : 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BOARD_L, DEATH_Y);
    ctx.lineTo(BOARD_R, DEATH_Y);
    ctx.stroke();
    ctx.restore();

    drawBoard();
    for (const p of pops) drawCoin(p.type, p.x, p.y, 1 + p.t * 2, 1 - p.t / 0.18);
    for (const f of falls) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      drawCoin(f.type, 0, 0);
      ctx.restore();
    }
    const playing = G.state === "play" || G.state === "pause";
    if (G.state === "play" && !shot && G.slide === 0) drawGuide();
    if (shot) drawCoin(shot.type, shot.x, shot.y);
    if (playing || G.state === "over" || (G.state === "records" && G.back === "over")) {
      drawLauncher();
      drawCashy();
    }

    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.3));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    for (const p of popups) {
      text(p.text, p.x, p.y, { size: 22, weight: 700, color: p.col, align: "center", stroke: COL.ink, strokeW: 5, alpha: Math.min(1, p.life * 2) });
    }
    ctx.restore();

    drawNotes();
    if (G.state !== "title" && !(G.state === "records" && G.back === "title")) drawHud();
    banners();
    if (G.state === "title") titleScreen();
    else if (G.state === "pause") pauseScreen();
    else if (G.state === "over") overScreen();
    else if (G.state === "records") recordsScreen();
  }

  // ───────────────────────── boot ─────────────────────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    window.requestAnimationFrame(frame);
  }

  // A tiny hook for testing, only when the URL has ?debug
  if (/[?&]debug\b/.test(window.location.search)) {
    window.__bubbles = {
      G,
      aim,
      Grid,
      get grid() {
        return grid;
      },
      get notes() {
        return notes;
      },
      get shot() {
        return shot;
      },
      get current() {
        return current;
      },
      set current(t) {
        current = t;
      },
      cellX,
      cellY,
      rowTime,
      startGame,
      gameOver,
      fire,
      update,
      draw,
    };
  }

  fillBoard(START_ROWS); // so the title screen has a backdrop
  Promise.all([
    loadImage("cashy", "assets/cashy.webp"),
    loadImage("crouch", "assets/cashy-crouch.webp"),
    document.fonts ? Promise.all([document.fonts.load("40px Cynatar"), document.fonts.load('700 16px "Noto Sans"'), document.fonts.load('400 16px "Noto Sans"')]).catch(() => {}) : null,
  ]).then(() => {
    makeSprites(); // after the fonts, so the $ coin uses Noto Sans
    last = performance.now();
    window.requestAnimationFrame(frame);
  });
})();
