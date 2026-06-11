# 🍳 EGG FRYER 3000 — Galactic Griddle

A silly, futuristic, cartoony **3D egg-frying game** for your phone. Crack space eggs
onto a hovering neon frying pan, serve them at the exact moment of perfection, and
climb the **HALL OF FLAME** leaderboard.

## How to play

1. **TAP THE PAN** to crack an egg into a free spot (up to 4 at once).
2. Each egg has a glowing **doneness ring**:
   - 🔵 cyan — still gooey
   - 🟢 green — almost there
   - 🟡 **pulsing gold — PERFECT! Tap it now!**
   - 🔴 red — crispy… then carbonized 💀
3. **TAP AN EGG** to serve it. Perfect serves build a combo multiplier (up to ×5).
   Burnt eggs cost you points *and* your dignity.
4. **DRAG** anywhere to tilt the pan — the eggs slide around. Purely for fun. Mostly.
5. You have **60 seconds**. Good luck, cadet.

| Serve timing | Points |
|---|---|
| Still gooey | +10 |
| Almost | +50 |
| **PERFECT** | **+100 × combo** |
| Bit crispy | +40 |
| Carbonized | −30 |

The leaderboard is stored locally on your device (localStorage).

## Run it on your iPhone

The game is a static site — no build step, no dependencies (Three.js is vendored).

**Option A — GitHub Pages (recommended):**
Enable GitHub Pages for this repo (Settings → Pages → deploy from branch), then open
the published URL in Chrome or Safari on your iPhone. Use "Add to Home Screen" for a
fullscreen app feel.

**Option B — local server:**

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the URL on a phone on the same network (modules require http://, so
opening index.html directly from the filesystem won't work).

## Files

- `index.html` — UI shell: HUD, start screen, game-over screen, leaderboard
- `game.js` — the game: 3D scene, egg physics, scoring, synth sound effects
- `three.module.js` — vendored Three.js r160 (works offline, no CDN needed)
- `manifest.webmanifest` — installable web app manifest
