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
4. **FLICK UP** on an egg to flip it. A flipped egg served in the perfect window
   is **OVER EASY** — worth 150 × combo. But flip while it's still gooey and the
   yolk breaks, capping that egg at +50. Burnt eggs are stuck to the pan.
5. **DRAG** anywhere to tilt the pan — the eggs slide around. Purely for fun. Mostly.
6. You have **60 seconds**. Good luck, cadet.

| Serve timing | Points |
|---|---|
| Still gooey | +10 |
| Almost | +50 |
| **PERFECT** | **+100 × combo** |
| **PERFECT, flipped (over easy)** | **+150 × combo** |
| Perfect, but yolk broken | +50 |
| Bit crispy | +40 |
| Carbonized | −30 |

The leaderboard is stored locally on your device (localStorage) — or globally for
everyone, if you set up the free shared backend below.

## Global leaderboard (shared across all phones, never erased)

Out of the box the Hall of Flame is per-device. To make one permanent board that
every phone shares:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   **Add project** (any name, Analytics not needed — it's free, no card required).
2. In the project: **Build → Realtime Database → Create Database**, pick any
   location, start in **locked mode**.
3. In the **Rules** tab, paste this and publish:
   ```json
   {
     "rules": {
       "scores": { ".read": true, ".write": true }
     }
   }
   ```
4. Copy the database URL shown at the top of the Data tab — it looks like
   `https://your-project-default-rtdb.firebaseio.com`.
5. Paste it into `FIREBASE_DB_URL` at the top of `game.js`, commit, push. Done —
   every phone now reads and writes the same Hall of Flame, and it survives
   cleared browsers, new phones, and the heat death of localStorage.

Notes:
- If the network is down, the game quietly falls back to the device-local board.
- You can also test against any backend without editing code via a URL param:
  `index.html?db=https://your-project-default-rtdb.firebaseio.com`
- The rules above let anyone who finds the URL write scores. For a game about
  frying cartoon eggs this is usually fine; Firebase App Check or auth can
  harden it later if your family turns out to be ruthless cheaters.

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
