import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, mkdir } from "fs/promises";
import { randomBytes } from "crypto";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  const BUILD_ID = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const BUILD_TIME = new Date().toISOString();

  console.log(`[build] BUILD_ID=${BUILD_ID} BUILD_TIME=${BUILD_TIME}`);

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Write build-info.json into the static output for reference
  try {
    await mkdir("dist/public", { recursive: true });
    await writeFile(
      "dist/public/build-info.json",
      JSON.stringify({ buildId: BUILD_ID, buildTime: BUILD_TIME }, null, 2),
    );
  } catch {}

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.BUILD_ID": `"${BUILD_ID}"`,
      "process.env.BUILD_TIME": `"${BUILD_TIME}"`,
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
