/* Cashy Bubbles: the coin grid.
 * Pure rules, no drawing, so it runs in the browser and in Node (see grid.test.js).
 * Rows are offset like a honeycomb: a shifted row sits half a coin to the right and holds one coin fewer.
 */
(function (root) {
  "use strict";

  const EMPTY = -1;

  function create(rows, cols) {
    return { rows, cols, parity: 0, cells: Array.from({ length: rows }, () => new Array(cols).fill(EMPTY)) };
  }

  const shifted = (g, r) => (r + g.parity) % 2 === 1;
  const rowLen = (g, r) => (shifted(g, r) ? g.cols - 1 : g.cols);
  const valid = (g, r, c) => r >= 0 && r < g.rows && c >= 0 && c < rowLen(g, r);
  const get = (g, r, c) => (valid(g, r, c) ? g.cells[r][c] : EMPTY);

  function neighbours(g, r, c) {
    // A shifted row's neighbours above and below are at c and c+1; an unshifted row's at c-1 and c.
    const d = shifted(g, r) ? 0 : -1;
    const out = [
      [r, c - 1],
      [r, c + 1],
      [r - 1, c + d],
      [r - 1, c + d + 1],
      [r + 1, c + d],
      [r + 1, c + d + 1],
    ];
    return out.filter(([rr, cc]) => valid(g, rr, cc));
  }

  // Every coin of the same type touching (r, c), including itself.
  function matchGroup(g, r, c) {
    const type = get(g, r, c);
    if (type === EMPTY) return [];
    const seen = new Set([r + "," + c]);
    const out = [];
    const stack = [[r, c]];
    while (stack.length) {
      const [rr, cc] = stack.pop();
      out.push([rr, cc]);
      for (const [nr, nc] of neighbours(g, rr, cc)) {
        const key = nr + "," + nc;
        if (!seen.has(key) && g.cells[nr][nc] === type) {
          seen.add(key);
          stack.push([nr, nc]);
        }
      }
    }
    return out;
  }

  // Coins with no path back to the ceiling (row 0). These fall.
  function floaters(g) {
    const held = new Set();
    const stack = [];
    for (let c = 0; c < rowLen(g, 0); c++) {
      if (g.cells[0][c] !== EMPTY) {
        held.add("0," + c);
        stack.push([0, c]);
      }
    }
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of neighbours(g, r, c)) {
        const key = nr + "," + nc;
        if (!held.has(key) && g.cells[nr][nc] !== EMPTY) {
          held.add(key);
          stack.push([nr, nc]);
        }
      }
    }
    const out = [];
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < rowLen(g, r); c++) if (g.cells[r][c] !== EMPTY && !held.has(r + "," + c)) out.push([r, c]);
    return out;
  }

  // A new row slides in at the top; everything moves down one and the honeycomb offset flips.
  function pushRow(g, types) {
    g.cells.pop();
    g.parity = 1 - g.parity;
    const row = new Array(g.cols).fill(EMPTY);
    for (let c = 0; c < rowLen(g, 0); c++) row[c] = types[c];
    g.cells.unshift(row);
  }

  // Which coin types are still on the board, so Cashy is only ever handed a colour he can use.
  function typesLeft(g) {
    const s = new Set();
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < rowLen(g, r); c++) if (g.cells[r][c] !== EMPTY) s.add(g.cells[r][c]);
    return s;
  }

  // The lowest row with a coin in it, or -1 when the board is clear.
  function lowestRow(g) {
    for (let r = g.rows - 1; r >= 0; r--) if (g.cells[r].some((t) => t !== EMPTY)) return r;
    return -1;
  }

  const api = { EMPTY, create, shifted, rowLen, valid, get, neighbours, matchGroup, floaters, pushRow, typesLeft, lowestRow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CashyGrid = api;
})(typeof window !== "undefined" ? window : globalThis);
