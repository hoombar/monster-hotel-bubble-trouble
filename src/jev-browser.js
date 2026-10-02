import { snapshot } from "./jev-state.js";

const token = new URLSearchParams(location.search).get("jev");
if (import.meta.hot && token) {
  const hot = import.meta.hot;
  const codes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
  const moves = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", stay: null };
  let timer;
  let connected = false;
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, {
    key: code === "Space" ? " " : code, code, keyCode: codes[code], which: codes[code], bubbles: true,
  }));
  const release = () => {
    clearTimeout(timer);
    for (const code of Object.keys(codes)) key("keyup", code);
  };
  // The client owns the action deadline, so losing the connection cannot leave keys held.
  hot.on("jev:command", ({ token: receivedToken, id, command, action, duration }) => {
    if (receivedToken !== token) return;
    const reply = (error) => hot.send("jev:reply", { token, id, error, state: snapshot() });
    if (command === "release") {
      release();
      return;
    }
    if (command === "snapshot") return reply();
    if (command !== "hold") return reply("Unknown command");
    release();
    const move = action?.replace(/_shoot$/, "");
    if (!Object.hasOwn(moves, move) || !Number.isInteger(duration) || duration < 50 || duration > 1000) return reply("Invalid action");
    if (document.hidden || !window.__hotel.running || window.__hotel.paused) return reply("Keep the game tab visible and unpaused");
    document.getElementById("game").focus({ preventScroll: true });
    if (moves[move]) key("keydown", moves[move]);
    if (action.endsWith("_shoot")) key("keydown", "Space");
    timer = setTimeout(() => { release(); reply(); }, duration);
  });
  hot.on("vite:ws:disconnect", release);
  window.addEventListener("pagehide", release);
  const ready = setInterval(() => {
    if (connected || !window.__hotel?.running) return;
    connected = true;
    hot.send("jev:hello", { token });
    document.getElementById("message").textContent = "Jev is playing. Keep this tab visible; decisions are logged in the terminal.";
  }, 100);
  hot.dispose(() => { clearInterval(ready); release(); });
}
