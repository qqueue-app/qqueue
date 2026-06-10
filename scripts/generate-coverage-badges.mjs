// Generates self-contained coverage badges from each package's
// coverage/coverage-summary.json (written by Vitest's json-summary reporter).
//
// Two badges are produced and committed to the repo so the README can show
// them via a relative path — no external badge service or secret required:
//   - badges/coverage-backend.svg : aggregate of all server-side packages
//   - badges/coverage-web.svg     : the React frontend, tracked separately
//
// Run after `pnpm test:coverage` (which runs coverage in every package).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Package dirs grouped by which badge they roll up into.
const GROUPS = {
  backend: [
    "apps/api",
    "apps/worker",
    "packages/email-engine",
    "packages/shared",
    "packages/sdk"
  ],
  web: ["apps/web"]
};

async function readSummary(pkgDir) {
  const file = join(root, pkgDir, "coverage", "coverage-summary.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    console.warn(`! no coverage summary for ${pkgDir} (skipped)`);
    return null;
  }
}

// Aggregate line coverage across a group by summing covered/total lines so a
// big package weighs more than a tiny one (a true repo-wide percentage).
async function aggregate(pkgDirs) {
  let covered = 0;
  let total = 0;
  for (const pkgDir of pkgDirs) {
    const summary = await readSummary(pkgDir);
    const lines = summary?.total?.lines;
    if (lines) {
      covered += lines.covered;
      total += lines.total;
    }
  }
  const pct = total === 0 ? 0 : (covered / total) * 100;
  return { covered, total, pct: Math.round(pct * 100) / 100 };
}

function color(pct) {
  if (pct >= 90) return "#4c1"; // brightgreen
  if (pct >= 80) return "#97ca00"; // green
  if (pct >= 70) return "#a4a61d"; // yellowgreen
  if (pct >= 60) return "#dfb317"; // yellow
  if (pct >= 50) return "#fe7d37"; // orange
  return "#e05d44"; // red
}

// Minimal shields-style "flat" badge. Widths are approximate (6px/char) which
// is fine for a two-segment label/value badge.
function badgeSvg(label, message) {
  const fill = color(parseFloat(message));
  const charW = 6.5;
  const pad = 10;
  const labelW = Math.round(label.length * charW + pad);
  const msgW = Math.round(message.length * charW + pad);
  const total = labelW + msgW;
  const labelX = (labelW / 2) * 10;
  const msgX = (labelW + msgW / 2) * 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${msgW}" height="20" fill="${fill}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - pad) * 10}">${label}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelW - pad) * 10}">${label}</text>
    <text x="${msgX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(msgW - pad) * 10}">${message}</text>
    <text x="${msgX}" y="140" transform="scale(.1)" fill="#fff" textLength="${(msgW - pad) * 10}">${message}</text>
  </g>
</svg>
`;
}

async function main() {
  const badgesDir = join(root, "badges");
  await mkdir(badgesDir, { recursive: true });

  const results = {};
  for (const [name, dirs] of Object.entries(GROUPS)) {
    const { pct, covered, total } = await aggregate(dirs);
    const label = name === "web" ? "web coverage" : "backend coverage";
    const svg = badgeSvg(label, `${pct.toFixed(2)}%`);
    await writeFile(join(badgesDir, `coverage-${name}.svg`), svg, "utf8");
    results[name] = { pct, covered, total };
    console.log(`✓ ${label}: ${pct.toFixed(2)}% (${covered}/${total} lines)`);
  }

  // A machine-readable summary, handy for CI logs / future tooling.
  await writeFile(
    join(badgesDir, "coverage-summary.json"),
    JSON.stringify(results, null, 2) + "\n",
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
