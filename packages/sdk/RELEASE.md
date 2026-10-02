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

## 4. Configure npm Trusted Publishing

In the `qqueue-sdk` package settings on npm, add a GitHub Actions trusted
publisher with:

- Organization or user: `qqueue-app`
- Repository: `qqueue`
- Workflow filename: `publish-sdk.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The workflow uses GitHub's short-lived OIDC identity. It does not need an
`NPM_TOKEN` secret. Package settings must be saved by an npm package maintainer.

## 5. Tag and Publish

Create and push a release tag that matches `packages/sdk/package.json`.
GitHub Actions will run the SDK preflight checks and publish the package to npm.

```sh
git tag qqueue-sdk-v<version>
git push origin qqueue-sdk-v<version>
```

If a tag's workflow failed after the tag was already pushed, do not move the
tag. After fixing the workflow on the default branch and configuring the trusted
publisher, start `Publish SDK` with **Run workflow** on that branch. Confirm
that its package version is still the intended unpublished version first.

After the workflow succeeds, verify the package page and install metadata:

```sh
npm view qqueue-sdk version
npm view qqueue-sdk dist.tarball
```
