export function snapshot(s = window.__hotel) {
  if (!s) throw new Error("Game state unavailable. Use the local development game, not the published site.");
  const round = (n) => Math.round(n * 10) / 10;
  return {
    running: s.running, paused: s.paused, score: s.score,
    player: { x: round(s.playerPos.x), y: round(s.playerPos.y), facing: { x: s.facing.x, y: s.facing.y }, carried: s.carried ? s.guests[s.carried.index].item : null },
    guests: s.guests.map((g) => ({ name: g.name, item: g.item, x: g.x, delivered: g.delivered })),
    toys: s.toys.map((t) => ({
      item: s.guests[t.index].item, belongsTo: s.guests[t.index].name,
      x: round(t.x), y: round(t.y), state: t.state,
      velocity: t.state === "free" ? { x: round(Math.cos(t.direction) * (t.index === 1 ? 39 : 29)), y: round(Math.sin(t.direction) * 29) } : { x: 0, y: 0 },
    })),
    bubbles: s.bubbles.map((b) => ({ x: round(b.x), y: round(b.y), vx: b.vx, vy: b.vy, life: round(b.life) })),
    bubbleCooldownMs: Math.max(0, Math.round(420 - (s.time.now - s.lastBubble))),
  };
}
