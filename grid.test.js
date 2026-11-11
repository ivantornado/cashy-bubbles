// Checks the grid rules. Run with: node grid.test.js
const assert = require("assert");
const G = require("./grid.js");
const E = G.EMPTY;

// Honeycomb shape: row 1 is shifted and one shorter.
let g = G.create(6, 5);
assert.strictEqual(G.rowLen(g, 0), 5);
assert.strictEqual(G.rowLen(g, 1), 4);

// Neighbours: unshifted (2,2) touches (1,1),(1,2),(3,1),(3,2); shifted (1,1) touches (0,1),(0,2),(2,1),(2,2).
const key = (list) => list.map((p) => p.join(",")).sort().join(" ");
assert.strictEqual(key(G.neighbours(g, 2, 2)), "1,1 1,2 2,1 2,3 3,1 3,2");
assert.strictEqual(key(G.neighbours(g, 1, 1)), "0,1 0,2 1,0 1,2 2,1 2,2");
// Edges are clipped: the last column of a shifted row does not exist.
assert.ok(!G.valid(g, 1, 4));

// A diagonal chain of three of one colour is one group; a different colour breaks it.
g.cells[0][2] = 1;
g.cells[1][1] = 1; // touches (0,1) and (0,2)
g.cells[2][1] = 1; // touches (1,0) and (1,1)
g.cells[2][2] = 2;
assert.strictEqual(G.matchGroup(g, 2, 1).length, 3);
assert.strictEqual(G.matchGroup(g, 2, 2).length, 1);
assert.deepStrictEqual(G.matchGroup(g, 4, 4), []);

// Popping the chain leaves (2,2) hanging, so it falls; a coin on the ceiling never falls.
g.cells[0][4] = 3;
for (const [r, c] of G.matchGroup(g, 2, 1)) g.cells[r][c] = E;
assert.strictEqual(key(G.floaters(g)), "2,2");

// Pushing a row moves everything down and flips the offset, so the same coins stay touching.
g = G.create(6, 5);
g.cells[0][0] = 1;
g.cells[1][0] = 1; // shifted row: touches (0,0) and (0,1)
G.pushRow(g, [2, 2, 2, 2, 2]);
assert.strictEqual(G.shifted(g, 0), true); // the new top row is now the shifted one
assert.strictEqual(G.rowLen(g, 0), 4); // so it only takes four coins
assert.strictEqual(g.cells[0][4], E);
assert.strictEqual(g.cells[1][0], 1);
assert.strictEqual(g.cells[2][0], 1);
assert.strictEqual(G.matchGroup(g, 2, 0).length, 2);
assert.deepStrictEqual(G.floaters(g), []);
assert.strictEqual(G.lowestRow(g), 2);
assert.deepStrictEqual([...G.typesLeft(g)].sort(), [1, 2]);
assert.strictEqual(G.lowestRow(G.create(3, 3)), -1);

console.log("grid ok");
