import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { parseArgs } from "node:util";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { snapshot } from "../src/jev-state.js";
import { actions, moves, askDecision } from "../src/jev-decision.js";

export async function observe(page) {
  return page.evaluate(snapshot);
}

export async function connectRemote(server, { token, signal, onDisconnect }) {
  const client = await new Promise((resolve, reject) => {
    const cleanup = () => { server.ws.off("jev:hello", hello); signal.removeEventListener("abort", abort); };
    const hello = (data, sender) => {
      if (data.token !== token) return;
      cleanup();
      resolve(sender);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    server.ws.on("jev:hello", hello);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  client.socket.once("close", onDisconnect);
  let sequence = 0;
  const command = (type, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const cleanup = () => {
      clearTimeout(timer);
      server.ws.off("jev:reply", reply);
      signal.removeEventListener("abort", abort);
    };
    const reply = (data, sender) => {
      if (sender !== client || data.token !== token || data.id !== id) return;
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.state);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Remote browser stopped responding. Keep its game tab visible.")); }, 5000);
    server.ws.on("jev:reply", reply);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    client.send("jev:command", { token, id, command: type, ...extra });
  });
  return {
    observe: () => command("snapshot"),
    hold: (action, duration) => command("hold", { action, duration }),
    release: async () => { client.send("jev:command", { token, command: "release" }); },
  };
}

export async function askJev(state, options) {
  return askDecision(state, { ...options, provider: "typesafe" });
}

export async function play(page, { apiKey, actionMs = 250, maxRequests = 500, signal, decide = askJev, log = console.log, driver }) {
  let previous;
  let failures = 0;
  let inputTokens = 0;
  driver ??= {
    observe: () => observe(page),
    hold: async (action, duration) => {
      const move = action.replace(/_shoot$/, "");
      if (moves[move]) await page.keyboard.down(moves[move]);
      if (action.endsWith("_shoot")) await page.keyboard.down("Space");
      await delay(duration, undefined, { signal });
    },
    release: async () => {
      for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]) await page.keyboard.up(key);
    },
  };
  const release = () => driver.release();
  try {
    for (let step = 1; step <= maxRequests; step++) {
      signal.throwIfAborted();
      const state = await driver.observe();
      const label = `[${String(step).padStart(4, "0")}]`;
      if (previous && (previous.score !== state.score || previous.player.carried !== state.player.carried || JSON.stringify(previous.toys.map((t) => t.state)) !== JSON.stringify(state.toys.map((t) => t.state)))) {
        log(`${label} Progress | score=${state.score}/6 carrying=${state.player.carried ?? "none"} toys=${state.toys.map((t) => `${t.item}:${t.state}`).join(",")}`);
      }
      if (state.score === 6) {
        log(`Won! Six deliveries completed. Input tokens reported: ${inputTokens}.`);
        return "won";
      }
      if (!state.running) throw new Error("The game stopped before winning");
      if (state.paused) throw new Error("Game paused. Restart the controller to play, or Ctrl+C to stop.");
      previous = state;
      log(`${label} Requesting Jev | player=(${state.player.x},${state.player.y}) carrying=${state.player.carried ?? "none"} score=${state.score}/6`);
      const started = performance.now();
      let decision;
      try {
        decision = await decide(state, { apiKey, actionMs, signal });
        failures = 0;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error.retryable || error.name === "TimeoutError" || error instanceof TypeError) || ++failures >= 3) throw error;
        log(`${label} Request failed (${error.message}); retrying with a fresh observation.`);
        await delay(1000 * failures, undefined, { signal });
        continue;
      }
      if (!Object.hasOwn(actions, decision.action)) throw new Error("Invalid controller action");
      inputTokens += decision.usage?.input_tokens ?? 0;
      log(`${label} ${Math.round(performance.now() - started)}ms | action=${decision.action} confidence=${decision.confidence ?? "unknown"} hold=${actionMs}ms`);
      signal.throwIfAborted();
      if ((await driver.observe()).paused) throw new Error("Game paused during the request");
      try {
        await driver.hold(decision.action, actionMs);
      } finally {
        await release();
      }
    }
    if ((await driver.observe()).score === 6) {
      log(`Won! Six deliveries completed. Input tokens reported: ${inputTokens}.`);
      return "won";
    }
    log(`Stopped at the ${maxRequests}-request limit. Input tokens reported: ${inputTokens}.`);
    return "limit";
  } finally {
    await release().catch(() => {});
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    "action-ms": { type: "string", default: "250" },
    "max-requests": { type: "string", default: "500" },
    headless: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log("Usage: npm run play:jev -- [--action-ms 250] [--max-requests 500] [--headless | --remote]\nRequires TYPESAFE_API_KEY. --remote controls a browser on your trusted LAN without launching Chromium. Ctrl+C stops.");
    return;
  }
  const actionMs = Number(values["action-ms"]);
  const maxRequests = Number(values["max-requests"]);
  if (values.remote && values.headless) throw new Error("Choose either --remote or --headless, not both");
  if (!values.remote && !values.headless && process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("No graphical display available. Use --remote to watch from another machine, or --headless for terminal-only play.");
  }
  if (!Number.isInteger(actionMs) || actionMs < 50 || actionMs > 1000) throw new Error("--action-ms must be an integer between 50 and 1000");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10_000) throw new Error("--max-requests must be an integer between 1 and 10000");
  try {
    loadEnvFile(".env");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("Set TYPESAFE_API_KEY in .env or your environment to a key from https://console.typesafe.ai/keys");
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Stopped by user"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let server;
  let browser;
  try {
    server = await createServer({ server: { host: values.remote ? "0.0.0.0" : "127.0.0.1", port: 5173, open: false } });
    await server.listen();
    const address = server.httpServer.address();
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`Starting real-time Jev player at ${url}. Limit: ${maxRequests} requests. Ctrl+C stops.`);
    if (values.remote) {
      const token = randomUUID();
      const connection = connectRemote(server, { token, signal: controller.signal, onDisconnect: () => controller.abort(new Error("Remote browser disconnected")) });
      console.log("Remote mode exposes a development server. Use only on a trusted LAN; do not expose this port to the internet.");
      for (const ip of Object.values(networkInterfaces()).flat().filter((ip) => ip && ip.family === "IPv4" && !ip.internal)) {
        console.log(`Open on your other machine: http://${ip.address}:${address.port}/?jev=${token}`);
      }
      console.log(`Local connection: ${url}/?jev=${token}\nWaiting for one browser. Open the connection URL and click the start button.`);
      const driver = await connection;
      console.log("Remote game connected. Jev is now playing in that browser.");
      await play(null, { apiKey, actionMs, maxRequests, signal: controller.signal, driver });
      console.log("Controller finished. Browser remains yours; Ctrl+C stops the server.");
      await delay(2 ** 31 - 1, undefined, { signal: controller.signal });
      return;
    }
    browser = await chromium.launch({ headless: values.headless, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.addInitScript(() => { window.__hotelAutomation = true; });
    page.on("close", stop);
    await page.goto(url);
    await page.locator("#start").click();
    const result = await play(page, { apiKey, actionMs, maxRequests, signal: controller.signal });
    if (result === "won" && !values.headless) {
      console.log("Browser stays open to view the result. Close it or press Ctrl+C to exit.");
      await delay(2 ** 31 - 1, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.log("Controller stopped; controls released.");
  } finally {
    await browser?.close();
    await server?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
