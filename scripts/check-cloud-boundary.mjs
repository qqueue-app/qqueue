import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const requiredFiles = [
  "apps/cloud/LICENSE",
  "apps/cloud/README.md",
  "apps/cloud/package.json",
  "docs/CLOUD_BOUNDARY.md",
];

const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

const corePackageFiles = [
  "apps/api/package.json",
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/shared/package.json",
  "packages/email-engine/package.json",
  "packages/storage/package.json",
  "packages/sdk/package.json",
];

const cloudDependencyViolations = corePackageFiles.flatMap((file) => {
  const path = join(root, file);

  if (!existsSync(path)) {
    return [];
  }

  const packageJson = JSON.parse(readFileSync(path, "utf8"));
  const dependencyMaps = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ];

  return dependencyMaps.some((dependencies) => dependencies?.["@qqueue/cloud"])
    ? [file]
    : [];
});

if (missing.length > 0 || cloudDependencyViolations.length > 0) {
  if (missing.length > 0) {
    console.error("Missing cloud boundary files:");
    for (const file of missing) {
      console.error(`- ${file}`);
    }
  }

  if (cloudDependencyViolations.length > 0) {
    console.error("Core packages must not depend on @qqueue/cloud:");
    for (const file of cloudDependencyViolations) {
      console.error(`- ${file}`);
    }
  }

  exit(1);
}

console.log("Cloud boundary check passed.");
