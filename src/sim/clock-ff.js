// Fast-forward: while the CPU runs out the clock (ai.cpuTempo "milk" / "chew": it snaps at the play clock's last
// seconds) and the human only waits on defense, the dead ball, its huddle and its line-up pass FF times faster
// (main.js frame). The game clock and the play clock lose exactly what they would; it's only real time saved. Real time
// comes back the moment the human is needed or moves: his play call to make, his defender to shift, a live play.
//   s: { human, autopilot, cpuBall, ot, phase, waitUser, idle (s since the human last moved), tempo, panel (a panel
//   open: an audible, a menu), recording (the instant replay still taping the play's end), boost (the human's >> button:
//   any CPU dead ball, whatever its tempo, even while he moves) }
export const FF = 5, FF_BOOST = 10;
export function ffRate(s) {
  if (!s.human || s.autopilot || !s.cpuBall || s.panel || s.recording) return 1;
  const dead = s.phase === "dead" || s.phase === "presnap" || (s.phase === "playcall" && !s.waitUser);
  if (s.boost && dead) return FF_BOOST;
  if (s.ot) return 1;
  if (s.tempo !== "milk" && s.tempo !== "chew") return 1;
  const waiting = s.phase === "dead" || s.phase === "presnap" || (s.phase === "playcall" && !s.waitUser);
  if (!waiting || s.idle < 0.3) return 1;
  return FF;
}
