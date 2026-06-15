import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const allowedLicenseTokens = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "PostgreSQL",
  "Python-2.0",
]);

// Packages whose license metadata is a non-standard string that the SPDX token
// parser cannot read, but which have been manually reviewed and accepted. Keyed
// by `name@version`.
const reviewedPackageExceptions = new Set([
  // `slick` declares its license as the non-SPDX string
  // "MIT (http://mootools.net/license.txt)" — it is MIT-licensed. Pulled in
  // transitively via mjml -> juice. Reviewed and accepted.
  "slick@1.12.2",
]);

function allPackagesExcepted(packages) {
  return packages.every((dependency) =>
    dependency.versions.every((version) =>
      reviewedPackageExceptions.has(`${dependency.name}@${version}`),
    ),
  );
}

const blockedLicenseTokens = new Set([
  "AGPL-1.0",
  "AGPL-1.0-only",
  "AGPL-1.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "GPL-1.0",
  "GPL-1.0-only",
  "GPL-1.0-or-later",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-2.0",
  "LGPL-2.0-only",
  "LGPL-2.0-or-later",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
]);

const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
});

if (result.error) {
  console.error(result.error.message);
  exit(1);
}

if (result.status !== 0) {
  console.error(result.stderr.trim() || result.stdout.trim());
  exit(result.status ?? 1);
}

const licenses = JSON.parse(result.stdout);
const failures = [];
const reviewed = [];

for (const [licenseExpression, packages] of Object.entries(licenses)) {
  const tokens = licenseExpression
    .match(/[A-Za-z0-9.+-]+/g)
    ?.filter((token) => token !== "AND" && token !== "OR" && token !== "WITH");

  if (!tokens || tokens.length === 0) {
    failures.push({
      licenseExpression,
      reason: "could not parse license expression",
      packages,
    });
    continue;
  }

  const blocked = tokens.filter((token) => blockedLicenseTokens.has(token));
  const unknown = tokens.filter((token) => !allowedLicenseTokens.has(token));

  if (blocked.length > 0) {
    failures.push({
      licenseExpression,
      reason: `blocked license token(s): ${blocked.join(", ")}`,
      packages,
    });
    continue;
  }

  if (unknown.length > 0) {
    // A non-SPDX license string is acceptable when every package carrying it has
    // been individually reviewed (see reviewedPackageExceptions).
    if (allPackagesExcepted(packages)) {
      reviewed.push({ licenseExpression, count: packages.length });
      continue;
    }

    failures.push({
      licenseExpression,
      reason: `unreviewed license token(s): ${unknown.join(", ")}`,
      packages,
    });
    continue;
  }

  reviewed.push({ licenseExpression, count: packages.length });
}

if (failures.length > 0) {
  console.error("Dependency license audit failed.");

  for (const failure of failures) {
    console.error(`\n${failure.licenseExpression}: ${failure.reason}`);
    for (const dependency of failure.packages.slice(0, 10)) {
      console.error(`- ${dependency.name}@${dependency.versions.join(", ")}`);
    }

    if (failure.packages.length > 10) {
      console.error(`- ...and ${failure.packages.length - 10} more`);
    }
  }

  exit(1);
}

console.log("Dependency license audit passed.");
for (const license of reviewed.sort((a, b) =>
  a.licenseExpression.localeCompare(b.licenseExpression),
)) {
  console.log(`- ${license.licenseExpression}: ${license.count} package(s)`);
}
