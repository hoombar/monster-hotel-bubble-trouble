export const moves = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", stay: null };
export const actions = Object.fromEntries(Object.keys(moves).flatMap((move) => [
  [move, `Move ${move === "stay" ? "nowhere (stay still)" : move}, without shooting.`],
  [`${move}_shoot`, `Move ${move === "stay" ? "nowhere (stay still)" : move}, while shooting bubbles.`],
]));
const rules = `You are playing Monster Hotel. Win by delivering six toys, two to each guest.
Coordinates: x increases right, y increases down. Player bounds x=48..952, y=340..712.
Move speed is 235 units/second. Movement sets facing; staying preserves facing.
Shoot in the facing direction. Bubble origin=(player.x+35*facing.x,player.y-38+35*facing.y).
Bubbles move at 290 units/second, last 1.15 seconds, and catch free toys within 65 units of (toy.x,toy.y-28).
Free toys wander slowly. Caught toys stop and never escape. Walk near a caught toy to pick it up automatically:
distance between (player.x,player.y-35) and (toy.x,toy.y-28) must be under 73.
Only one toy can be carried; shooting does nothing while carrying.
Deliver automatically by moving with a carried toy to its matching guest: abs(player.x-guest.x)<83 and player.y<382.
Prioritize delivering a carried toy, then collecting a caught toy, then catching a nearby free toy.
Avoid overshooting your target. There are no obstacles, enemies or penalties.
The game keeps running during this request; positions may have changed slightly by execution.
The decisionContext explicitly identifies the current task, the correct destination, and directions needed.
While carrying, ignore ALL other guests and toys. Teddy ONLY goes to Pip; pillow ONLY goes to Yoyo; duck ONLY goes to Moss.
If already high enough for delivery, move horizontally toward the matching doorway; do not keep moving up against the wall.
Each action option includes a geometric forecast. Compare these instead of inferring direction from item names.
Movement changes aim BEFORE firing, even at a wall. left_shoot fires LEFT, not in your previous facing direction.
For catching, prefer a shot whose forecast can hit a free toy; shooting away from all toys is not useful.
For collecting and delivering, prefer actions that reduce distance to the target without shooting.
Blocked movement does not advance the player, but can be useful for aiming a shot. Do not repeat blocked non-shooting actions.
Forecasts are approximations, not guarantees: toys turn/bounce and inference takes time. Recent outcomes show actual effects.`;

export function buildDecisionContext(state, actionMs) {
  const { player } = state;
  const round = (n) => Math.round(n * 10) / 10;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const vector = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, stay: { x: 0, y: 0 } };
  const destination = player.carried ? state.guests.find((g) => g.item === player.carried) : null;
  const caught = state.toys.filter((t) => t.state === "caught");
  const phase = destination ? "deliver" : caught.length ? "collect" : "catch";
  const targets = destination ? [{
    item: player.carried, guest: destination.name,
    deliveryRegion: { xMinExclusive: destination.x - 83, xMaxExclusive: destination.x + 83, yMaxExclusive: 382 },
    directionsNeeded: [
      ...(player.x <= destination.x - 83 ? ["right"] : player.x >= destination.x + 83 ? ["left"] : []),
      ...(player.y >= 382 ? ["up"] : []),
    ],
    horizontalAlreadyAligned: Math.abs(player.x - destination.x) < 83,
    verticalAlreadyAligned: player.y < 382,
  }] : (phase === "collect" ? caught : state.toys.filter((t) => t.state === "free")).map((toy) => ({
    item: toy.item, guest: state.guests.find((g) => g.item === toy.item)?.name,
    state: toy.state, center: { x: toy.x, y: round(toy.y - 28) },
    pickupPlayerPosition: { x: toy.x, y: round(toy.y + 7) },
    deltaToPickup: { x: round(toy.x - player.x), y: round(toy.y + 7 - player.y) },
    distanceToPickup: round(Math.hypot(toy.x - player.x, toy.y + 7 - player.y)),
  })).sort((a, b) => a.distanceToPickup - b.distanceToPickup);
  const distanceToGoal = (position) => destination
    ? Math.hypot(Math.max(0, Math.abs(position.x - destination.x) - 82), Math.max(0, position.y - 381))
    : targets.length ? Math.min(...targets.map((target) => Math.max(0, Math.hypot(position.x - target.pickupPlayerPosition.x, position.y - target.pickupPlayerPosition.y) - 72))) : 0;
  const distanceBefore = distanceToGoal(player);
  const forecasts = Object.fromEntries(Object.keys(actions).map((action) => {
    const move = action.replace(/_shoot$/, "");
    const v = vector[move];
    const end = { x: round(clamp(player.x + v.x * 235 * actionMs / 1000, 48, 952)), y: round(clamp(player.y + v.y * 235 * actionMs / 1000, 340, 712)) };
    const facing = move === "stay" ? player.facing : v;
    const requested = action.endsWith("_shoot");
    const canFireDuringAction = requested && !player.carried && state.bubbleCooldownMs < actionMs;
    const forecast = {
      endPosition: end,
      movementBlocked: move !== "stay" && end.x === player.x && end.y === player.y,
      facingAfterAction: facing,
      distanceToGoalAfter: round(distanceToGoal(end)),
      goalDistanceReduction: round(distanceBefore - distanceToGoal(end)),
      shooting: { requested, canFireDuringAction },
    };
    if (destination) {
      forecast.passesCorrectDeliveryRegion = Math.min(player.x, end.x) < destination.x + 83 && Math.max(player.x, end.x) > destination.x - 83 && Math.min(player.y, end.y) < 382;
    }
    if (requested && player.carried) forecast.shooting.reason = `Cannot shoot while carrying ${player.carried}; deliver it to ${destination.name}.`;
    else if (requested && !canFireDuringAction) forecast.shooting.reason = "Bubble cooldown outlasts this action.";
    if (canFireDuringAction) {
      const fireDelay = state.bubbleCooldownMs / 1000;
      const origin = {
        x: clamp(player.x + v.x * 235 * fireDelay, 48, 952) + facing.x * 35,
        y: clamp(player.y + v.y * 235 * fireDelay, 340, 712) - 38 + facing.y * 35,
      };
      forecast.shooting.firstBubbleOrigin = { x: round(origin.x), y: round(origin.y) };
      forecast.shooting.firstBubbleEnd = { x: round(origin.x + facing.x * 290 * 1.15), y: round(origin.y + facing.y * 290 * 1.15) };
      forecast.shooting.toyIntersections = state.toys.filter((t) => t.state === "free").map((toy) => {
        // Closest approach of bubble and toy, assuming the toy keeps its current velocity.
        const velocity = toy.velocity ?? { x: 0, y: 0 };
        const dx = origin.x - (toy.x + velocity.x * fireDelay);
        const dy = origin.y - (toy.y - 28 + velocity.y * fireDelay);
        const vx = facing.x * 290 - velocity.x;
        const vy = facing.y * 290 - velocity.y;
        const at = clamp(-(dx * vx + dy * vy) / (vx * vx + vy * vy), 0, 1.15);
        const closestDistance = Math.hypot(dx + vx * at, dy + vy * at);
        return { item: toy.item, closestDistance: round(closestDistance), mayCatch: closestDistance < 65 };
      });
    }
    return [action, forecast];
  }));
  return { phase, carriedItem: player.carried, destination: destination ? { guest: destination.name, item: destination.item, x: destination.x } : null, targets, distanceToGoal: round(distanceBefore), forecasts };
}

export async function askDecision(state, { apiKey, actionMs, signal, history = [], provider = "openrouter", fetchImpl = fetch, onExchange }) {
  const context = buildDecisionContext(state, actionMs);
  const { forecasts, ...goal } = context;
  const criteria = Object.fromEntries(Object.entries(actions).map(([action, description]) => [action, `${description}\nForecast: ${JSON.stringify(forecasts[action])}`]));
  const native = provider === "typesafe";
  const endpoint = native ? "https://api.typesafe.ai/v1/systemone" : "https://openrouter.ai/api/alpha/decisions";
  const body = {
    model: native ? "jev-latest" : "typesafe/jev-1.13",
    state: `${rules}\nEach chosen action will be held for ${actionMs}ms.\nCurrent state:\n${JSON.stringify({ ...state, decisionContext: goal, recentOutcomes: history.slice(-5) })}`,
    questions: { action: { type: "choice", instructions: "Choose the best next action for decisionContext.phase. Match the carried item to decisionContext.destination, compare action forecasts, and avoid repeating actions that made no progress. For catching, consider predicted bubble/toy intersections; for collecting or delivering, reduce distance to the correct goal.", criteria } },
  };
  const exchange = { endpoint, method: "POST", request: body, status: "pending" };
  const notify = () => {
    if (!onExchange) return;
    // Never retain headers, and redact credentials even if a provider echoes them.
    const json = JSON.stringify(exchange);
    onExchange(JSON.parse(apiKey ? json.replaceAll(apiKey, "[REDACTED]") : json));
  };
  const started = performance.now();
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  notify();
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: requestSignal,
      body: JSON.stringify(body),
    });
    exchange.httpStatus = response.status;
    const text = await response.text();
    let result;
    let parsed = false;
    try {
      result = JSON.parse(text);
      parsed = true;
      exchange.response = result;
    } catch {
      exchange.responseText = text;
    }
    if (!response.ok) {
      const error = new Error(`Jev API returned HTTP ${response.status}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    if (!parsed) throw new Error("Jev returned an unreadable response");
    const answer = result?.answers?.action;
    if (!answer || !Object.hasOwn(actions, answer.choice)) throw new Error("Jev returned an invalid action");
    exchange.status = "received";
    return { action: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities, usage: result.usage, context };
  } catch (error) {
    const failure = requestSignal.aborted ? requestSignal.reason : error;
    exchange.status = signal.aborted ? "cancelled" : requestSignal.aborted ? "timed out" : "failed";
    exchange.error = failure.message;
    throw failure;
  } finally {
    exchange.durationMs = Math.round(performance.now() - started);
    notify();
  }
}
