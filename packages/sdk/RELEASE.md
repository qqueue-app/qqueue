# qqueue-sdk Release Checklist

Use this checklist from the repository root when publishing `qqueue-sdk`.

## 1. Version Bump

Update `packages/sdk/package.json` using semver:

- Patch for backwards-compatible fixes.
- Minor for new backwards-compatible SDK features.
- Major for breaking API changes.

Then update `packages/sdk/CHANGELOG.md` with the release date and user-facing
changes.

## 2. Preflight

```sh
pnpm --filter qqueue-sdk test
pnpm --filter qqueue-sdk typecheck
pnpm --filter qqueue-sdk build
```

## 3. Install Smoke Test

Create a tarball and install it into a temporary project:

```sh
pnpm --dir packages/sdk pack
mkdir -p /tmp/qqueue-sdk-smoke
cd /tmp/qqueue-sdk-smoke
npm init -y
npm install /path/to/qqueue/packages/sdk/qqueue-sdk-<version>.tgz
node --input-type=module -e "import { QQueueClient } from 'qqueue-sdk'; new QQueueClient({ apiKey: 'qq_live_test' }); console.log('ok')"
```

The import should print `ok` without module resolution errors.

## 4. Publish

```sh
cd packages/sdk
npm publish --access public
```

After publishing, verify the package page and install metadata:

```sh
npm view qqueue-sdk version
npm view qqueue-sdk dist.tarball
```

## 5. Tag

Tag the repo with the SDK version after publish succeeds:

```sh
git tag qqueue-sdk-v<version>
git push origin qqueue-sdk-v<version>
```
