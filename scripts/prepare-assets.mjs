import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Resolve paths from this script so it can be run from any working directory.
const images = new URL("../images/", import.meta.url);
const assets = new URL("../public/assets/", import.meta.url);
const sprites = [
  "hotel-helper.png",
  "guest-slime.png",
  "guest-bath-monster.png",
  "guest-yeti.png",
  "item-duck.png",
  "item-pillow.png",
  "item-teddy.png",
];
const pink = [255, 40, 245];

await mkdir(assets, { recursive: true });

for (const filename of sprites) {
  const { data, info } = await sharp(fileURLToPath(new URL(filename, images)))
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];

      // Test every pixel, not just border-connected regions, to clear holes.
      // Low green AND strong red/blue dominance protect lavender and outlines.
      const strength = Math.max(
        0,
        Math.min(
          1,
          (r - 100) / 120,
          (b - 100) / 110,
          (145 - g) / 50,
          (Math.min(r, b) - g - 65) / 90,
        ),
      );
      const removed = strength * strength * (3 - 2 * strength);
      const retained = 1 - removed;
      data[offset + 3] = Math.round(data[offset + 3] * retained);

      if (data[offset + 3] === 0) {
        data.fill(0, offset, offset + 3);
        continue;
      }

      // Unmix the pink contribution on partially keyed antialiased edges.
      if (removed > 0) {
        for (let channel = 0; channel < 3; channel++) {
          data[offset + channel] = Math.round(
            Math.max(
              0,
              Math.min(
                255,
                (data[offset + channel] - removed * pink[channel]) / retained,
              ),
            ),
          );
        }
      }

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error(`Chroma key removed the entire sprite: ${filename}`);
  }

  const output = await sharp(data, { raw: { width, height, channels } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize({
      width: 320,
      height: 320,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toFile(fileURLToPath(new URL(filename, assets)));
  console.log(
    `${filename}: ${output.width}x${output.height} (transparent sprite)`,
  );
}

const lobby = await sharp(fileURLToPath(new URL("hotel-lobby.png", images)))
  .resize({ width: 1400 })
  .png()
  .toFile(fileURLToPath(new URL("hotel-lobby.png", assets)));
console.log(`hotel-lobby.png: ${lobby.width}x${lobby.height}`);
