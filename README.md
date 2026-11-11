# Cashy Bubbles

Cashy fires coins at the board. Match three or more of a kind to pop them. Anything left hanging drops for big points. Don't let the coins reach the street.

Plain HTML, CSS and JavaScript on a canvas. No libraries and no build step. The game area is 706 × 720, the same as Cashy Tower and Cashy Invaders, so the Cashy site can embed it in the same frame.

## Play locally

```bash
python3 -m http.server 8092
```

Then open http://localhost:8092.

## Controls

| | Keyboard | Mouse | Touch |
|---|---|---|---|
| Aim | ← → or A D | move the mouse | drag on the board |
| Fire | Space, ↑, W or Enter | click | let go |
| Pause | P or Esc | | |
| Sound | M or the speaker button | | |

The game pauses on its own when you switch tabs.

## Rules

- Three or more touching coins of the same kind pop: 10 points each.
- Coins no longer hanging from the ceiling drop. Drops double with every coin (2 coins = 40, 5 = 320, 10 = 10,240).
- The dots under the launcher count the shots until a new row pushes in from the top.
- A clock also brings a new row on its own, even if you never shoot. It starts at 30 seconds and gets half a second quicker with every level (about 9.5 seconds by level 42), with a 5-second floor. A bar above the board drains and turns pink in the last 5 seconds. Any new row, from shots or the clock, starts both counters again.
- Clear the whole board for a 2,500 bonus and a fresh board.
- If a coin lands past the dashed line, the run is over.
- Every 1,500 points since the last level-up is a new level, one at a time, however big the score. Rows come quicker (8 shots down to 4) and the clock speeds up, and a fifth coin joins at level 3 and a sixth at level 5. A level-up sets off flying cash and confetti, for show only.
- Cashy is only handed colours that are still on the board.

Each coin has its own mark as well as its colour (dot, diamond, star, $, triangle, square), so the game is playable without telling the colours apart.

The best score and your best five runs are saved in this browser only (localStorage). Nothing is sent anywhere.

## Files

- `index.html`: the page
- `style.css`: the frame and the sound button
- `grid.js`: the board rules (matching, hanging coins, new rows), with no drawing code
- `grid.test.js`: checks those rules. Run it with `node grid.test.js`.
- `game.js`: everything else (drawing, input, sound, screens)
- `assets/`: Cashy art and the fonts (Cynatar, Noto Sans)

Add `?debug` to the URL to expose `window.__bubbles` for testing.
