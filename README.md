# Monster Hotel: Bubble Trouble

A cosy browser game for little hotel helpers. Catch runaway toys in bubbles,
pick them up, and deliver them to three friendly monsters. Six deliveries win
the shift. No timer, lives, penalties, accounts, or backend.

## Run

Requires Node.js 20.19+ or 22.12+ (tested with Node 24).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, usually http://localhost:5173. The server
also listens on your local network so a phone or tablet on the same Wi-Fi can
use `http://YOUR-COMPUTER-IP:5173`. Use only on a trusted network; this is a
development server, not a public production service.

## Play

- Arrow keys move; hold space to blow bubbles in your last movement direction.
- Walk into a caught toy to collect it. Carry one at a time.
- Walk to the matching guest's glowing doorstep to deliver automatically.
- Pip wants the teddy, Yoyo the pillow, and Moss the duck. Each wants two.
- Caught toys never escape. There is no losing.
- Escape or the Pause button pauses; switching tabs also pauses.
- Sound effects default to on. The Sound button toggles the gentle synthesised chimes.
- The separate Music button toggles looping `music/chiptune.mp3` at a gentle
  volume. Music defaults to on and starts when you start the game (browsers block
  autoplay before interaction). It pauses with the game or when leaving the tab, and
  resumes from the same position. The choice carries across shifts until reload.
- On-screen direction and bubble buttons support phones and tablets.
- After six deliveries, play again or swap players.

## Jev AI Player

### Browser-Only OpenRouter Player

```sh
npm run dev
```

Open the printed URL with `?ai=1`, usually `http://localhost:5173/?ai=1`.
From another machine on your trusted network, use
`http://YOUR-COMPUTER-IP:5173/?ai=1` (use the actual port Vite prints).
No Playwright browser, display server, terminal controller, or backend is needed.

Enter an **OpenRouter API key** from https://openrouter.ai/settings/keys in the
optional AI panel, then click **Start Jev**. It starts the game if needed and
calls `typesafe/jev-1.13` via `https://openrouter.ai/api/alpha/decisions`.
Use an ordinary inference key with a small spending limit, not a management key.
Calls are billed to your OpenRouter account. The native TypeSafe key in `.env`
is for the separate terminal player below; the browser panel does not read it.
Never put API keys in a `VITE_` variable or the published source.

Jev gets the game state and rules, chooses up/down/left/right/stay with or without
shooting, and holds the action for 250ms by default. Gameplay continues while
requests are in flight; the player waits between actions. The panel and browser
console show decisions, latency, confidence, top action probabilities, progress,
and reported token/cost totals. Runs default to 50 requests, including retries.
Calls time out after 10 seconds; temporary failures retry at most twice.

**Stop** releases AI controls without pausing the game. Pause, focus-loss pause,
tab hiding, and restarting also stop the controller. Keep the tab visible and
do not steer manually during a run. A request limit or win ends the run; you can
start another run or another shift. This is an experiment, not a guaranteed
winning bot.

Requests include explicit toy ownership, the matching delivery region when
carrying, relative pickup positions, toy velocities, and per-action geometric
forecasts: movement bounds, resulting facing, goal-distance changes, and whether
the first bubble could intercept a toy. The last five actual action outcomes
help expose repeated wall-sticking or lack of progress. These are observations
and physics estimates, not an automatic navigation policy: Jev still chooses
every action. Shot forecasts assume a toy keeps its current velocity; direction
changes, bounces, frame timing, and inference latency can invalidate them.
If a pickup or delivery changes the task during inference, the old action is
discarded and the next request uses fresh state, without pausing gameplay.

The key stays in memory unless you select **Remember for this tab**, which uses
`sessionStorage`, not a cookie. It survives reloads in that tab and normally
disappears when the tab closes. **Forget key** stops the run and clears both the
input and tab storage. Keys are sent only to OpenRouter, not your game server,
and are never intentionally logged. Same-origin scripts and browser extensions
can still access browser-held keys.

The panel is absent without `?ai=1`. It also works in production at
`https://benpearson.dev/monster-hotel/?ai=1` after publishing; no production
global scene hook is needed. To test that build locally:

```sh
npm run build -- --base=/monster-hotel/
npm run preview -- --base=/monster-hotel/
```

Open the preview URL with `/monster-hotel/?ai=1`. Building and previewing do not
publish the site.

### Terminal TypeSafe Player

The earlier terminal-controlled proof of concept is also available:

```sh
npx playwright install chromium
npm run play:jev
```

Set `TYPESAFE_API_KEY=your-typesafe-api-key` in the root `.env` file, which is
ignored by Git. The controller loads it automatically; an existing environment
variable takes precedence. Get a native TypeSafe API key from
https://console.typesafe.ai/keys. The script
uses `jev-latest` at the TypeSafe API, not OpenRouter's Jev Router (which selects
other models). Check your account's API access and billing; requests may incur
charges. The key stays in the Node process and is never sent to the game browser.
Do not use a `VITE_` environment variable for secrets.

The script starts its own loopback-only Vite server and visible Chromium window.
No separate `npm run dev` is needed. Jev receives coordinates, toy states, guest
requests, bubble positions, and game rules, then chooses one of ten actions:
up/down/left/right/stay, with or without shooting. The controller holds actual
keyboard controls for 250ms, releases them, then requests the next decision.
The game continues moving while requests are in flight; it never pauses for
inference. The player stays still between actions. Stdout shows requests,
response latency, actions, confidence, pickups/captures/deliveries, and input
token totals. This is an experiment, not a guaranteed winning bot.

```sh
npm run play:jev -- --action-ms 350 --max-requests 200
npm run play:jev -- --headless --max-requests 20
npm run play:jev -- --help
```

### Watch From Another Machine

On a server or SSH session without a graphical display, run:

```sh
npm run play:jev -- --remote --max-requests 50
```

Open the printed network URL (including its `?jev=...` session token) in the
browser on your other machine, then click the start button. The controller drives
that actual browser's game over Vite's development websocket; no Chromium or X
server is needed on the terminal machine. Decisions are still logged in the
terminal, and gameplay stays real-time. Keep the game tab visible and unpaused.
Closing it stops the controller. When the request limit is reached or Jev wins,
the game remains open and the server waits for Ctrl+C.

The controller starts its own server. If port 5173 is occupied by another game
instance, it selects another port and prints the correct URL. Use that URL, not
the already-running instance; separate browser tabs have separate game state.
Remote mode listens on the network, so use it only on a trusted LAN and allow
the printed port through your firewall if needed. Do not expose it to the
internet. The API key stays on the terminal machine, not in the browser.

The default limit is 500 requests, including failed attempts. Calls time out
after 10 seconds; temporary failures retry at most twice with fresh state.
Ctrl+C or closing the browser stops the controller and releases controls.
On winning, the visible browser remains open until closed; reaching the request
limit closes it. The automation window opts out of the game's focus-loss pause
so you can watch the terminal, but keep the game tab visible for browser rendering.
The Pause button still stops gameplay and causes the controller to exit.

This uses the development-only scene hook, not the published website. Neither
the automation flag nor scene access is enabled in the production game.

## Artwork

Original Nano Banana artwork is preserved in `images/`. The game uses cropped,
transparent, resized copies in `public/assets/`. macOS `._` files are ignored.
To regenerate the game assets after replacing originals:

```sh
npm run assets
```

The script removes the bright pink background, including enclosed holes.
Keep the existing filenames. Bubble effects, shadows, and celebrations are
drawn by the game. Fonts have local fallbacks if Google Fonts is unavailable.

## Build and Test

```sh
npm run build
npm run preview
```

Deploy the `dist/` folder to any static website host, at the site root.

### Publish to benpearson.dev

The website hosts the game at `https://benpearson.dev/monster-hotel/`.
With the website checkout alongside this repository, run:

```sh
npm run publish:site
npm run test:production
```

An alternate checkout location can be supplied with
`npm run publish:site -- /path/to/benpearson.dev`. This builds with Vite's
`/monster-hotel/` base and replaces the website's `static/monster-hotel/` folder.
It does not commit, push, or deploy automatically. Commit source changes here
and generated files in the website repository, then push both repositories.
The website's normal Hugo/Cloudflare build publishes the game unchanged.

The production smoke test uses the built game, not the development server.
To test a Hugo preview or the deployed game instead, set `GAME_TEST_URL`, e.g.
`GAME_TEST_URL=https://benpearson.dev/monster-hotel/ npm run test:production`.
For other hosts/subfolders, use `npm run build -- --base=/your-folder/`.

### Browser Tests

```sh
npx playwright install chromium
npm test
```

Browser tests cover loading, keyboard movement, pause, bubble collisions,
permanent captures, pickup, wrong and correct deliveries, six-delivery wins,
restart, mobile layout, and pointer controls. Tests stage positions using a
development-only scene reference; the production build does not expose it.

Built with Phaser 3 and Vite. No API keys or AI subscription are needed to play.
