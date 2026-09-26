import Phaser from "phaser";
import musicUrl from "../music/chiptune.mp3?url";
import "./style.css";

const $ = (id) => document.getElementById(id);
const W = 1000,
  H = 750;
const GUESTS = [
  {
    key: "slime",
    item: "teddy",
    name: "Pip",
    label: "teddy",
    x: 175,
    tint: 0xb8a0da,
  },
  {
    key: "yeti",
    item: "pillow",
    name: "Yoyo",
    label: "pillow",
    x: 500,
    tint: 0xa6d9ea,
  },
  {
    key: "bath-monster",
    item: "duck",
    name: "Moss",
    label: "duck",
    x: 835,
    tint: 0xa1d8b0,
  },
];
const touch = {
  up: false,
  down: false,
  left: false,
  right: false,
  bubble: false,
};
const pointers = new Map(Object.keys(touch).map((key) => [key, new Set()]));
let scene;
let soundEnabled = true;
let audio;
let musicEnabled = true;
let musicStarted = false;
const music = $("background-music");
music.src = musicUrl;
music.volume = 0.3;

function updateMusic() {
  $("music").textContent = musicEnabled ? "Music on" : "Music off";
  $("music").setAttribute("aria-pressed", String(musicEnabled));
  if (!musicEnabled || !musicStarted || scene?.paused || document.hidden) {
    music.pause();
    return;
  }
  music.play().catch((error) => {
    // Switching off or pausing while the track loads cancels play normally.
    if (error.name === "AbortError") return;
    musicEnabled = false;
    updateMusic();
    $("music").title = "Music could not play. Click to try again.";
  });
}

function chime(notes = [660, 880], duration = 0.13) {
  if (!soundEnabled) return;
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  notes.forEach((frequency, i) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const at = audio.currentTime + i * duration;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.065, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration + 0.08);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.1);
  });
}

class Hotel extends Phaser.Scene {
  constructor() {
    super("Hotel");
  }

  preload() {
    this.load.image("lobby", "/assets/hotel-lobby.png");
    this.load.image("helper", "/assets/hotel-helper.png");
    for (const guest of GUESTS) {
      this.load.image(guest.key, `/assets/guest-${guest.key}.png`);
      this.load.image(guest.item, `/assets/item-${guest.item}.png`);
    }
    this.load.on("loaderror", () => {
      this.failedLoad = true;
      $("start").textContent = "Artwork missing: please reload";
      $("message").textContent = "Run npm run assets, then reload the page.";
    });
  }

  create() {
    scene = this;
    this.add.image(W / 2, H / 2, "lobby").setDisplaySize(W, H);
    this.running = false;
    this.paused = false;
    this.score = 0;
    this.carried = null;
    this.facing = new Phaser.Math.Vector2(0, -1);
    this.lastBubble = -1000;
    this.toys = [];
    this.bubbles = [];
    this.guests = GUESTS.map((data) => {
      const halo = this.add
        .ellipse(data.x, 322, 142, 40, data.tint, 0.22)
        .setStrokeStyle(3, data.tint, 0.8);
      const sprite = this.add.image(data.x, 305, data.key).setOrigin(0.5, 1);
      sprite.setDisplaySize((sprite.width * 137) / sprite.height, 137);
      const request = this.add.container(data.x + 62, 161);
      const panel = this.add
        .graphics()
        .fillStyle(0xfffcf0)
        .lineStyle(2, 0x40374f);
      panel
        .fillRoundedRect(-32, -34, 64, 66, 16)
        .strokeRoundedRect(-32, -34, 64, 66, 16);
      panel.fillTriangle(-18, 30, -7, 30, -22, 44);
      const icon = this.add.image(0, -2, data.item);
      icon.setDisplaySize((icon.width * 44) / icon.height, 44);
      request.add([panel, icon]);
      this.add
        .text(data.x, 335, data.name, {
          fontFamily: "Georgia",
          fontSize: "18px",
          color: "#493d51",
          backgroundColor: "#fff5df",
          padding: { x: 12, y: 3 },
        })
        .setOrigin(0.5);
      return { ...data, halo, sprite, request, delivered: 0 };
    });
    this.shadow = this.add.ellipse(500, 605, 64, 17, 0x59475b, 0.16);
    this.player = this.add.image(500, 600, "helper").setOrigin(0.5, 1);
    this.player.setDisplaySize(
      (this.player.width * 104) / this.player.height,
      104,
    );
    this.playerPos = new Phaser.Math.Vector2(500, 600);
    this.aim = this.add.graphics();
    this.keys = this.input.keyboard.createCursorKeys();
    this.input.keyboard.clearCaptures();
    for (let i = 0; i < 3; i++) this.spawnToy(i);
    this.updateScore();
    if (!this.failedLoad) {
      $("start").disabled = false;
      $("start").textContent = "Let's help the monsters";
    }
    // Expose the scene only on the local dev server for repeatable browser tests.
    if (import.meta.env.DEV) window.__hotel = this;
  }

  spawnToy(index) {
    const guest = this.guests[index];
    const x = [245, 505, 765][index] + Phaser.Math.Between(-40, 40);
    const y = Phaser.Math.Between(455, 650);
    const shadow = this.add.ellipse(x, y + 3, 43, 12, 0x59475b, 0.12);
    const sprite = this.add.image(x, y, guest.item).setOrigin(0.5, 1);
    sprite.setDisplaySize((sprite.width * 62) / sprite.height, 62);
    this.toys.push({
      index,
      x,
      y,
      sprite,
      shadow,
      state: "free",
      direction: Phaser.Math.FloatBetween(0, Math.PI * 2),
      turnAt: 0,
      phase: Math.random() * 6,
      ring: null,
    });
  }

  startShift() {
    this.running = true;
    musicStarted = true;
    updateMusic();
    this.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE"]);
    $("intro").hidden = true;
    $("pause").disabled = false;
    this.message(
      "Hold space to bubble a toy. Walk into its bubble to pick it up!",
    );
    $("game").focus({ preventScroll: true });
    chime([392, 523, 659]);
  }

  message(text) {
    $("message").textContent = text;
  }

  updateScore() {
    $("score").textContent = `${this.score} / 6`;
    $("stars").innerHTML = Array.from(
      { length: 6 },
      (_, i) =>
        `<span class="${i < this.score ? "earned" : ""}">&#9733;</span>`,
    ).join("");
  }

  togglePause(force) {
    if (!this.running) return;
    this.paused = force ?? !this.paused;
    updateMusic();
    this.tweens.paused = this.paused;
    $("paused").hidden = !this.paused;
    $("pause").textContent = this.paused ? "Resume" : "Pause";
    this.input.keyboard.resetKeys();
    Object.keys(touch).forEach((key) => (touch[key] = false));
    pointers.forEach((active) => active.clear());
    if (this.paused) this.input.keyboard.clearCaptures();
    else
      this.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE"]);
    if (this.paused) $("resume").focus({ preventScroll: true });
    else $("game").focus({ preventScroll: true });
  }

  drawBubble(x, y, radius = 39) {
    const ring = this.add.graphics();
    ring.fillStyle(0xc6f4f6, 0.22).fillCircle(0, 0, radius);
    ring.lineStyle(3, 0xffffff, 0.9).strokeCircle(0, 0, radius);
    ring.lineStyle(2, 0x86d9e6, 0.85).strokeCircle(0, 0, radius - 3);
    ring
      .lineStyle(4, 0xffffff, 0.85)
      .beginPath()
      .arc(0, 0, radius - 8, 3.7, 4.55)
      .strokePath();
    ring.fillStyle(0xffffff, 0.85).fillCircle(12, 19, 3);
    return ring.setPosition(x, y);
  }

  blow(time) {
    if (time - this.lastBubble < 420 || this.carried) return;
    this.lastBubble = time;
    const x = this.playerPos.x + this.facing.x * 35;
    const y = this.playerPos.y - 38 + this.facing.y * 35;
    const ring = this.drawBubble(x, y, 35);
    ring.setDepth(900);
    this.bubbles.push({
      x,
      y,
      vx: this.facing.x * 290,
      vy: this.facing.y * 290,
      life: 1.15,
      ring,
    });
    chime([520 + Math.random() * 180], 0.055);
  }

  sparkle(x, y, color = 0xf7c969) {
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      const particle = this.add.star(x, y, 5, 3, 7, color).setDepth(1000);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * 85,
        y: y + Math.sin(angle) * 65 - 20,
        alpha: 0,
        angle: 90,
        duration: 700,
        onComplete: () => particle.destroy(),
      });
    }
  }

  deliver(toy) {
    const guest = this.guests[toy.index];
    guest.delivered++;
    this.score++;
    this.carried = null;
    toy.sprite.destroy();
    toy.shadow.destroy();
    toy.ring?.destroy();
    this.toys.splice(this.toys.indexOf(toy), 1);
    this.sparkle(guest.x, 225);
    this.tweens.add({
      targets: guest.sprite,
      y: 278,
      duration: 170,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeOut",
    });
    chime([523, 659, 784]);
    this.updateScore();
    if (guest.delivered < 2) this.spawnToy(toy.index);
    else {
      guest.request.setVisible(false);
      guest.halo.setAlpha(0.35);
    }
    this.message(
      `${guest.name} loves their ${guest.label}! ${6 - this.score} more happy deliveries.`,
    );
    if (this.score === 6) {
      this.running = false;
      this.input.keyboard.clearCaptures();
      this.aim.clear();
      this.bubbles.forEach((b) => b.ring.destroy());
      this.bubbles = [];
      $("pause").disabled = true;
      this.message("All the toys are home. Thank you, hotel hero!");
      this.time.delayedCall(850, () => {
        $("finished").hidden = false;
        $("restart").focus({ preventScroll: true });
        chime([523, 659, 784, 1047], 0.19);
      });
    }
  }

  update(time, delta) {
    if (!this.running || this.paused) return;
    const dt = Math.min(delta / 1000, 0.04);
    let dx =
      Number(this.keys.right.isDown || touch.right) -
      Number(this.keys.left.isDown || touch.left);
    let dy =
      Number(this.keys.down.isDown || touch.down) -
      Number(this.keys.up.isDown || touch.up);
    const length = Math.hypot(dx, dy);
    if (length) {
      dx /= length;
      dy /= length;
      this.facing.set(dx, dy);
    }
    this.playerPos.x = Phaser.Math.Clamp(
      this.playerPos.x + dx * 235 * dt,
      48,
      952,
    );
    this.playerPos.y = Phaser.Math.Clamp(
      this.playerPos.y + dy * 235 * dt,
      340,
      712,
    );
    this.player
      .setPosition(
        this.playerPos.x,
        this.playerPos.y + (length ? Math.sin(time / 85) * 3 : 0),
      )
      .setDepth(this.playerPos.y);
    this.player.setAngle(length ? Math.sin(time / 110) * 3 : 0);
    this.shadow
      .setPosition(this.playerPos.x, this.playerPos.y + 1)
      .setDepth(this.playerPos.y - 1);
    this.aim.clear();
    if (!this.carried) {
      this.aim.fillStyle(0x317b79, 0.45);
      for (let i = 0; i < 3; i++)
        this.aim.fillCircle(
          this.playerPos.x + this.facing.x * (50 + i * 13),
          this.playerPos.y - 38 + this.facing.y * (50 + i * 13),
          3 - i * 0.6,
        );
      this.aim.setDepth(899);
    }
    if (this.keys.space.isDown || touch.bubble) this.blow(time);

    for (const bubble of [...this.bubbles]) {
      bubble.x += bubble.vx * dt;
      bubble.y += bubble.vy * dt;
      bubble.life -= dt;
      bubble.ring
        .setPosition(bubble.x, bubble.y)
        .setAlpha(Math.min(1, bubble.life * 3));
      for (const toy of this.toys) {
        if (
          toy.state === "free" &&
          Phaser.Math.Distance.Between(bubble.x, bubble.y, toy.x, toy.y - 28) <
            65
        ) {
          toy.state = "caught";
          toy.ring = this.drawBubble(toy.x, toy.y - 28, 44);
          bubble.life = 0;
          this.sparkle(toy.x, toy.y - 28, 0xb1e6e3);
          if (!this.carried)
            this.message("Lovely bubble! Walk into it to pick up the toy.");
          chime([784, 988], 0.07);
          break;
        }
      }
      if (bubble.life <= 0) {
        bubble.ring.destroy();
        this.bubbles.splice(this.bubbles.indexOf(bubble), 1);
      }
    }

    for (const toy of [...this.toys]) {
      if (toy.state === "free") {
        if (time > toy.turnAt) {
          toy.direction += Phaser.Math.FloatBetween(-1.3, 1.3);
          toy.turnAt = time + Phaser.Math.Between(1000, 2400);
        }
        toy.x += Math.cos(toy.direction) * (toy.index === 1 ? 39 : 29) * dt;
        toy.y += Math.sin(toy.direction) * 29 * dt;
        if (toy.x < 65 || toy.x > 935) {
          toy.direction = Math.PI - toy.direction;
          toy.x = Phaser.Math.Clamp(toy.x, 65, 935);
        }
        if (toy.y < 418 || toy.y > 698) {
          toy.direction = -toy.direction;
          toy.y = Phaser.Math.Clamp(toy.y, 418, 698);
        }
        toy.sprite.setAngle(Math.sin(time / 170 + toy.phase) * 7);
      } else if (
        toy.state === "caught" &&
        !this.carried &&
        Phaser.Math.Distance.Between(
          this.playerPos.x,
          this.playerPos.y - 35,
          toy.x,
          toy.y - 28,
        ) < 73
      ) {
        toy.state = "carried";
        this.carried = toy;
        chime([880], 0.1);
        this.message(
          `Take the ${this.guests[toy.index].label} to ${this.guests[toy.index].name} at the glowing door!`,
        );
      }
      if (toy.state === "carried") {
        toy.x = this.playerPos.x + 47;
        toy.y = this.playerPos.y - 48;
        const guest = this.guests[toy.index];
        if (
          Math.abs(this.playerPos.x - guest.x) < 83 &&
          this.playerPos.y < 382
        ) {
          this.deliver(toy);
          continue;
        }
      }
      const bob =
        Math.sin(time / (toy.state === "free" ? 130 : 350) + toy.phase) * 4;
      toy.sprite
        .setPosition(toy.x, toy.y + bob)
        .setDepth(toy.state === "carried" ? 850 : toy.y);
      toy.shadow
        .setPosition(toy.x, toy.y + 2)
        .setDepth(toy.y - 1)
        .setVisible(toy.state !== "carried");
      if (toy.ring)
        toy.ring
          .setPosition(toy.x, toy.y - 28 + bob)
          .setDepth(toy.state === "carried" ? 851 : toy.y + 1);
    }
    this.guests.forEach((guest, index) => {
      const target = this.carried?.index === index;
      guest.halo.setScale(target ? 1.1 + Math.sin(time / 180) * 0.1 : 1);
      guest.halo.setAlpha(target ? 1 : guest.delivered === 2 ? 0.25 : 0.55);
      guest.request.setAlpha(this.carried && !target ? 0.45 : 1);
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: W,
  height: H,
  backgroundColor: "#f5dfb9",
  scene: Hotel,
  render: { antialias: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  audio: { noAudio: true },
});

$("start").addEventListener("click", () => scene?.startShift());
$("pause").addEventListener("click", () => scene?.togglePause());
$("resume").addEventListener("click", () => scene?.togglePause(false));
$("restart").addEventListener("click", () => {
  $("finished").hidden = true;
  scene.scene.restart();
  scene.events.once("create", () => scene.startShift());
});
$("sound").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  $("sound").textContent = soundEnabled ? "Sound on" : "Sound off";
  $("sound").setAttribute("aria-pressed", String(soundEnabled));
  chime();
  $("game").focus({ preventScroll: true });
});
$("music").addEventListener("click", () => {
  musicEnabled = !musicEnabled;
  musicStarted = true;
  $("music").removeAttribute("title");
  updateMusic();
  if (scene?.running && !scene.paused) $("game").focus({ preventScroll: true });
});
document.querySelectorAll("[data-key]").forEach((button) => {
  const active = pointers.get(button.dataset.key);
  const release = (event) => {
    active.delete(event.pointerId);
    touch[button.dataset.key] = active.size > 0;
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    active.add(event.pointerId);
    touch[button.dataset.key] = true;
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});
document.addEventListener("focusin", (event) => {
  if (!scene) return;
  if (event.target === $("game") && scene.running && !scene.paused) {
    scene.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE"]);
  } else scene.input.keyboard.clearCaptures();
});
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && !event.repeat) scene?.togglePause();
});
window.addEventListener("blur", () => {
  if (scene?.running) scene.togglePause(true);
  music.pause();
});
window.addEventListener("focus", updateMusic);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && scene?.running) scene.togglePause(true);
  updateMusic();
});
