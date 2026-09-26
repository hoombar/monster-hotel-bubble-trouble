import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = path.resolve(
  process.argv[2] ?? path.join(root, "../benpearson.dev"),
);
const target = path.join(site, "static/monster-hotel");
const config = await readFile(path.join(site, "hugo.toml"), "utf8");
if (!config.includes('baseURL = "https://benpearson.dev/"')) {
  throw new Error(
    "Expected the benpearson.dev Hugo checkout as the destination.",
  );
}

// Never replace an unrelated directory that happens to use the game's name.
const existingTarget = await lstat(target).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
if (existingTarget) {
  if (!existingTarget.isDirectory())
    throw new Error("Destination must be a real directory.");
  const existing = await readFile(path.join(target, "index.html"), "utf8");
  if (!existing.includes("Monster Hotel"))
    throw new Error("Destination is not a Monster Hotel build.");
}

execFileSync("npm", ["run", "build", "--", "--base=/monster-hotel/"], {
  cwd: root,
  stdio: "inherit",
});
await mkdir(path.join(site, "static"), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(path.join(root, "dist"), target, { recursive: true });
console.log(
  `Published build to ${target}. Review, commit, and push the website to deploy.`,
);
