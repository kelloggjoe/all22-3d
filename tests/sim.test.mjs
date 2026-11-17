// Headless: full CPU-vs-CPU games between human teams through the copied ALL-22 PRO World.
import { World } from "../src/sim/world.js";
import { createBus } from "../src/sim/events.js";
import { TEAM_DEFS, makeTeam } from "../src/teams.js";

let fail = 0;
const games = Number(process.argv[2] || 4);
for (let g = 0; g < games; g++) {
  const home = makeTeam(TEAM_DEFS[g % TEAM_DEFS.length]), away = makeTeam(TEAM_DEFS[(g + 3) % TEAM_DEFS.length]);
  const bus = createBus();
  const w = new World({ bus, home, away, seed: 100 + g, user: "home", autopilot: true, headless: true, quarterSec: 600 });
  w.start();
  let steps = 0;
  const t0 = Date.now();
  while (w.phase !== "over" && steps < 60 * 60 * 90) {
    w.update(1 / 60); steps++;
    if (w.phase === "halftime") w.continueHalftime();
  }
  const errs = w.errors.concat(bus.errors || []);
  const s = w.stats;
  console.log(`${home.abbr} ${w.score.home} - ${w.score.away} ${away.abbr} | plays ${w.playNo} | ovr ${home.ovr}/${away.ovr} | yds ${s.home.yds ?? JSON.stringify(s.home).slice(0, 80)} | ${((Date.now() - t0) / 1000).toFixed(1)}s | errors ${errs.length}`);
  if (w.phase !== "over" || errs.length) { fail++; console.log(errs.slice(0, 3)); }
}
const t = makeTeam(TEAM_DEFS[0]);
for (const s of ["QB", "HB", "WR1", "LT", "DE1", "CB1", "K"]) { const r = t.players[s].r; console.log(s, t.players[s].full, `spd ${r.speed.toFixed(2)} pow ${r.power.toFixed(0)} arm ${r.arm.toFixed(0)} hands ${r.hands.toFixed(0)} fit ${r.fit.toFixed(2)} kick ${r.kick.toFixed(0)}`); }
process.exit(fail ? 1 : 0);
