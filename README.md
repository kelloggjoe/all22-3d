# Ragdoll Football

Eleven-on-eleven football in Three.js with original, generated human rosters and physics-driven tackles.
The rules, playbook, AI, and controls build on the ALL-22 PRO simulation in `src/sim/`.

## Play
Serve the folder over HTTP and open it (the page loads three.js from a CDN):

```bash
python3 -m http.server 5180
```

Then open http://localhost:5180. Keyboard or gamepad; HOW TO PLAY on the title screen lists every control.
Open PLAYER GENERATOR to browse players from the current league, reroll all rosters, or play as the team on screen.
To recreate a league, add `?roster=1234` to the URL with that league's seed.

## Layout
- `src/sim/` football simulation, playbook, and input
- `src/teams.js` eight fictional teams and their kits
- `src/player-generator.js` seeded human players with position profiles, physical builds, traits, and gear
- `src/kooky.js` the players' looks: DNA from each player's ratings plus seeded nonsense, built as toon blobs with ink outlines on the shared skeleton
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
