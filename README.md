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
