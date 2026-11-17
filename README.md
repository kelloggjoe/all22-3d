# ALL-22 3D

Eleven-on-eleven football in three.js. The football is ALL-22 PRO's: its World (rules, clock, downs, special
teams, overtime), physics, play AI, playbook and controls are copied unchanged into `src/sim/`. ALL-22 3D swaps the
Pokémon rosters for fictional human teams and replaces the Mode 7 pixel renderer with a 3D stadium and animated
players.

## Play
Serve the folder over HTTP and open it (the page loads three.js from a CDN):

```bash
python3 -m http.server 5180
```

Then open http://localhost:5180. Keyboard or gamepad; HOW TO PLAY on the title screen lists every control.

## Layout
- `src/sim/` ALL-22 PRO's simulation and input, unchanged
- `src/teams.js` eight fictional teams; each player's stat record runs through the sim's own rating math
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
