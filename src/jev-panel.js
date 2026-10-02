import { actions, askDecision } from "./jev-decision.js";

const storageKey = "monster-hotel.openrouter-key";

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function mountJevPanel({ getState, prepare, setAction }) {
  const panel = document.createElement("section");
  panel.className = "ai-panel";
  panel.id = "ai-panel";
  panel.setAttribute("aria-labelledby", "ai-heading");
  panel.innerHTML = `
    <p class="eyebrow">AFTER-HOURS EXPERIMENT</p>
    <h2 id="ai-heading">Jev at the desk</h2>
    <p class="ai-description">A real-time guest helper, powered by <code>typesafe/jev-1.13</code> on OpenRouter.</p>
    <form id="ai-form">
      <label for="ai-key">Your OpenRouter API key</label>
      <input id="ai-key" type="password" autocomplete="off" spellcheck="false" required placeholder="sk-or-..." aria-describedby="ai-key-note">
      <label class="ai-remember"><input id="ai-remember" type="checkbox"> Remember for this tab</label>
      <p id="ai-key-note" class="ai-note">Sent only to OpenRouter. Use a key with a small spending limit. Browser scripts and extensions may access it.</p>
      <div class="ai-settings">
        <label for="ai-duration">Action hold (ms)<input id="ai-duration" type="number" min="50" max="1000" step="1" value="250" required></label>
        <label for="ai-limit">Request limit<input id="ai-limit" type="number" min="1" max="10000" step="1" value="50" required></label>
      </div>
      <div class="ai-buttons">
        <button id="ai-start" type="submit" class="primary-button">Start Jev</button>
        <button id="ai-stop" type="button" class="small-button" disabled>Stop</button>
        <button id="ai-forget" type="button" class="small-button">Forget key</button>
      </div>
    </form>
    <p id="ai-status" role="status">Ready. The game keeps running during requests.</p>
    <div class="ai-log-heading"><span>DECISION LOG</span><button id="ai-clear" type="button" class="small-button">Clear log</button></div>
    <div id="ai-log" role="log" aria-live="off" aria-label="Jev decision log" tabindex="0"></div>
    <p class="ai-note">Also logged in the browser console. Keep this tab visible. Stop returns control to you; it does not pause the game.</p>`;
  document.querySelector(".touch-controls").insertAdjacentElement("afterend", panel);
  document.querySelector(".hotel").classList.add("ai-enabled");
  const $ = (id) => panel.querySelector(`#${id}`);
  const keyField = $("ai-key");
  const remember = $("ai-remember");
  const status = $("ai-status");
  const logElement = $("ai-log");
  let controller;
  const log = (message) => {
    const line = document.createElement("div");
    line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    logElement.append(line);
    while (logElement.children.length > 150) logElement.firstChild.remove();
    logElement.scrollTop = logElement.scrollHeight;
    console.info(`[Jev] ${message}`);
  };
  const saveKey = () => {
    try {
      if (remember.checked && keyField.value.trim()) sessionStorage.setItem(storageKey, keyField.value.trim());
      else sessionStorage.removeItem(storageKey);
    } catch {
      remember.checked = false;
      log("Tab storage unavailable; the key will only be kept in memory.");
    }
  };
  try {
    keyField.value = sessionStorage.getItem(storageKey) ?? "";
    remember.checked = Boolean(keyField.value);
  } catch { /* Some browsers disable session storage. Memory-only mode still works. */ }
  keyField.addEventListener("input", saveKey);
  remember.addEventListener("change", saveKey);

  const stop = (reason = "Stopped by you") => {
    if (!controller || controller.signal.aborted) return;
    controller.abort(new Error(reason));
    setAction(null);
    status.textContent = reason;
    log(reason);
  };
  $("ai-stop").addEventListener("click", () => stop());
  $("ai-forget").addEventListener("click", () => {
    stop("Stopped; key forgotten");
    keyField.value = "";
    remember.checked = false;
    saveKey();
    log("Key removed from this panel and tab storage.");
  });
  $("ai-clear").addEventListener("click", () => logElement.replaceChildren());
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop("Stopped because the tab was hidden"); });
  window.addEventListener("pagehide", () => stop("Page closed"));

  $("ai-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (controller) return;
    const apiKey = keyField.value.trim();
    const actionMs = Number($("ai-duration").value);
    const maxRequests = Number($("ai-limit").value);
    if (!apiKey || !Number.isInteger(actionMs) || actionMs < 50 || actionMs > 1000 || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000) return;
    saveKey();
    controller = new AbortController();
    const signal = controller.signal;
    for (const id of ["ai-key", "ai-remember", "ai-duration", "ai-limit", "ai-start"]) $(id).disabled = true;
    $("ai-stop").disabled = false;
    let tokens = 0;
    let cost = 0;
    let previous;
    let failures = 0;
    const history = [];
    const progress = (state) => {
      if (previous) {
        if (state.score > previous.score) log(`Delivery! Score ${state.score}/6.`);
        if (state.player.carried && state.player.carried !== previous.player.carried) log(`Picked up ${state.player.carried}.`);
        for (const toy of state.toys) {
          if (toy.state === "caught" && previous.toys.some((t) => t.item === toy.item && t.state === "free")) log(`Caught ${toy.item} in a bubble.`);
        }
      }
      previous = state;
    };
    try {
      if (document.hidden) throw new Error("Keep the game tab visible.");
      prepare();
      log(`Started real-time Jev. Limit ${maxRequests} requests; ${actionMs}ms actions.`);
      for (let step = 1; step <= maxRequests; step++) {
        signal.throwIfAborted();
        const state = getState();
        progress(state);
        if (state.score === 6) break;
        if (!state.running || state.paused) throw new Error("Game stopped or paused.");
        status.textContent = `Request ${step}/${maxRequests}: waiting for Jev`;
        log(`[${step}] Requesting | player=(${state.player.x},${state.player.y}) carrying=${state.player.carried ?? "none"} score=${state.score}/6`);
        const started = performance.now();
        let decision;
        try {
          decision = await askDecision(state, { apiKey, actionMs, signal, history });
          failures = 0;
        } catch (error) {
          signal.throwIfAborted();
          if (!(error.retryable || error.name === "TimeoutError" || error instanceof TypeError) || ++failures >= 3) throw error;
          log(`[${step}] Temporary request failure. Retrying with fresh state (${failures}/2).`);
          await wait(1000 * failures, signal);
          continue;
        }
        signal.throwIfAborted();
        const current = getState();
        if (Number.isFinite(decision.usage?.input_tokens)) tokens += decision.usage.input_tokens;
        if (Number.isFinite(decision.usage?.cost)) cost += decision.usage.cost;
        if (current.score === 6) break;
        if (!current.running || current.paused || document.hidden) throw new Error("Game stopped, paused, or hidden during the request.");
        if (current.player.carried !== state.player.carried || current.score !== state.score) {
          log(`[${step}] Task changed during inference; discarding the stale action and requesting fresh state.`);
          continue;
        }
        const confidence = Number.isFinite(decision.confidence) ? decision.confidence.toFixed(2) : "unknown";
        log(`[${step}] ${Math.round(performance.now() - started)}ms | ${decision.action} | confidence=${confidence}`);
        const { context } = decision;
        log(context.destination
          ? `Observed goal: deliver ${context.carriedItem} to ${context.destination.guest} at x=${context.destination.x}; needed=${context.targets[0].directionsNeeded.join("+") || "already in delivery region"}.`
          : `Observed goal: ${context.phase}; targets=${context.targets.map((target) => target.item).join(",")}.`);
        const forecast = context.forecasts[decision.action];
        if (forecast.movementBlocked) log("Forecast: movement blocked by a wall.");
        if (forecast.shooting.canFireDuringAction) log(`Forecast: shot may catch ${forecast.shooting.toyIntersections.filter((toy) => toy.mayCatch).map((toy) => toy.item).join(",") || "no toy"}.`);
        if (decision.probabilities) {
          const probabilities = Object.entries(decision.probabilities).filter(([action, p]) => Object.hasOwn(actions, action) && Number.isFinite(p)).sort((a, b) => b[1] - a[1]).slice(0, 3);
          log(`Options: ${probabilities.map(([action, p]) => `${action}=${p.toFixed(2)}`).join(" ")}`);
        }
        status.textContent = `Request ${step}/${maxRequests}: ${decision.action}`;
        setAction(decision.action);
        try { await wait(actionMs, signal); }
        finally { setAction(null); }
        const after = getState();
        const moved = Math.round(Math.hypot(after.player.x - current.player.x, after.player.y - current.player.y) * 10) / 10;
        history.push({ action: decision.action, from: { x: current.player.x, y: current.player.y }, to: { x: after.player.x, y: after.player.y }, moved, carriedBefore: current.player.carried, carriedAfter: after.player.carried, deliveries: after.score - current.score });
        if (history.length > 5) history.shift();
        if (moved === 0 && after.score === current.score && after.player.carried === current.player.carried) log(`Outcome: no movement or delivery from ${decision.action}.`);
      }
      const final = getState();
      progress(final);
      status.textContent = final.score === 6 ? "Won! Six happy deliveries." : "Request limit reached. You can start another run.";
      log(status.textContent);
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof TypeError ? "Network request failed. Check your connection and OpenRouter access." : error.message;
        status.textContent = message;
        log(message);
      }
    } finally {
      setAction(null);
      log(`Run totals: ${tokens} input tokens; $${cost.toFixed(6)} reported cost. Failed requests may not report usage.`);
      controller = null;
      for (const id of ["ai-key", "ai-remember", "ai-duration", "ai-limit", "ai-start"]) $(id).disabled = false;
      $("ai-stop").disabled = true;
    }
  });
  return { stop };
}
