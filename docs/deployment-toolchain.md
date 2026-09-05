# Deployment toolchain

Use pnpm 11.25.0, declared in both `packageManager` and `engines.pnpm`.
When upgrading, update both fields and the onboarding instructions together,
then verify frozen installation, lint, unit tests, and the production build.
`pnpm self-update` alone can leave the two manifest fields inconsistent.

`pnpm run deploy:prod` synchronizes environment variables, applies pending
migrations, and deploys. Both environment sync and deployment use the installed
Vercel CLI through `pnpm exec`, so they share the exact lockfile dependency.
Install development dependencies before deploying from a fresh checkout.

## Vercel CLI selection (2026-09-05)

An unversioned `pnpm dlx vercel` selected 59.11.2 and failed the project's
`trustPolicy: no-downgrade` check under both pnpm 11.19.0 and 11.25.0.
The npm registry lists a GitHub trusted publisher for recent Vercel versions,
but their distribution metadata lacks the attestations pnpm expects.
Updating pnpm alone does not fix that failure.

Use Vercel 58.4.4, whose registry metadata includes publisher provenance and
passes the existing policy, rather than adding exceptions for the newer CLI
and its numerous builder packages. Its exact version and integrity are locked.
Review future CLI upgrades explicitly; do not remove supply-chain controls.

## Reviewed dependency exception

`undici@5.29.0` is required by the CLI and lacks provenance although later
major versions established a stronger publication trust level. On 2026-09-05,
its npm registry ECDSA signature was verified with Node's crypto API against
the public key from `https://registry.npmjs.org/-/npm/v1/keys`, covering
`undici@5.29.0:<dist.integrity>`. Registry metadata identifies publisher
`matteo.collina` and repository `nodejs/undici`.

This supports a version-specific `trustPolicyExclude` entry, not a claim that
the package has provenance or that a registry signature audits its code.
The lockfile pins its integrity. The exception does not cover other versions.
Release-age checks, other trust checks, and installation script restrictions
remain enabled. No additional installation scripts were enabled.
