// Balance sample: N CPU-vs-CPU games, points and play outcomes per game (node tests/balance.mjs 8)
import { World } from "../src/sim/world.js";
import { createBus } from "../src/sim/events.js";
import { TEAM_DEFS, makeTeam } from "../src/teams.js";
const N = Number(process.argv[2] || 8), tot = {};
const add = (k, v = 1) => { tot[k] = (tot[k] || 0) + v; };
for (let g = 0; g < N; g++) {
  const home = makeTeam(TEAM_DEFS[g % 8]), away = makeTeam(TEAM_DEFS[(g + 3) % 8]);
  const bus = createBus();
  for (const ev of ["tackle", "knockover", "dominoHold", "brokenTackle", "interception", "dive", "touchdown"]) bus.on(ev, (e) => add(ev + (ev === "dive" ? (e.player.hasBall ? ":carrier" : ":tackler") : "")));
  bus.on("tackle", (e) => { if (e.approach && e.approach.dive) add("tackle:byDive"); });
  const w = new World({ bus, home, away, seed: 100 + g, user: "home", autopilot: true, headless: true, quarterSec: 600 });
  w.start();
  for (let s = 0; w.phase !== "over" && s < 60 * 60 * 90; s++) { w.update(1 / 60); if (w.phase === "halftime") w.continueHalftime(); }
  add("points", w.score.home + w.score.away); add("plays", w.playNo);
  add("yds", w.stats.home.passYds + w.stats.home.rushYds + w.stats.away.passYds + w.stats.away.rushYds);
}
console.log(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, +(v / N).toFixed(1)])));
