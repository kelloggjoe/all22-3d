# Snack League

Eleven-on-eleven football in Three.js where every player is a snack. Draft your eleven from 25 snacks, then knock the toppings off each other with physics-driven tackles.
The rules, playbook, AI, and controls build on the ALL-22 PRO simulation in `src/sim/`.

## Play
Serve the folder over HTTP and open it (the page loads three.js from a CDN):

```bash
python3 -m http.server 5180
```

Then open http://localhost:5180. Keyboard or gamepad; HOW TO PLAY on the title screen lists every control.
PLAY: pick your colors and an opponent, then draft. The board shows an offensive formation and the 25 snacks in four
groups (Balance, Technique, Speed, Power). Pick a spot, then a snack. Your eleven play both ways: each spot also shows
the defensive job (and the kicker) that snack takes. The CPU drafts from the snacks you leave.

## Layout
- `src/sim/` football simulation, playbook, and input
- `src/snacks.js` the 25 snacks: group, stats, build and card line
- `src/teams.js` eight fictional teams and their kits; the draft (auto-draft, two-way assignments, drafted teams)
- `src/snack.js` each snack's 3D build on the shared skeleton, and the toppings that fly off on big hits
- `src/portraits.js` the draft board's portraits
- `src/kooky.js` the toon look and shared building helpers (toon material, ink outline, mounting parts on bones)
- `src/players3d.js` the athletes: model, uniform shader, helmet, pads, numbers, animation state machine
- `src/render3d.js` stadium, field, crowd, lights, ball, play art, and the sim camera → three.js camera
- `src/ui.js`, `src/playcall.js`, `src/menus.js` HUD, play calling, screens
- `tools/trim-anims.mjs` builds `assets/models/anims.glb` from the animation library

## Tests
```bash
node tests/sim.test.mjs 4
```
plays four CPU-vs-CPU games headless and fails on any World error.

## Credits
Player model (Universal Base Characters) and animations (Universal Animation Library) by
[Quaternius](https://quaternius.com), CC0. See `assets/models/LICENSE-Quaternius.txt`.
