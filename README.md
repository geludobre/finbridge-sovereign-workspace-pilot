# FinBridge Sovereign Workspace — adult browser-only pilot

A no-backend, local-first project and notes workspace. The static assets run on each participant's device. The hosting provider serves HTML, CSS, JavaScript and service-worker files only.

## What works
- Pseudonymous local account on each browser profile (not a cloud identity).
- AES-256-GCM encrypted project records in IndexedDB. Passphrase key derived with PBKDF2-SHA256, 600,000 iterations and a per-account random salt.
- Lock/unlock, local notes and project editing, deletion, and safe text analysis in a Web Worker.
- Offline-capable app shell via service worker.
- Portable encrypted JSON backup and import to another device, strictly by user action.
- Per-browser profile separation with separately derived keys; no telemetry or external AI inference.

## Important limits
- This is **not** a cloud service, multiplayer collaboration platform, full coding agent, server-authenticated identity provider or multi-tenant backend.
- Do not use student, minor, health, financial, employment, or confidential production data during the beta.
- Local browser profiles are not operating-system security boundaries. Users sharing an OS login should use separate OS/browser accounts.
- A strong passphrase is mandatory; forgetting it makes encrypted content unrecoverable. The hosting operator has no recovery key.
- Browser data can be removed by storage eviction, clearing site data, browser profile deletion or device loss. Export encrypted backups regularly.
- The static hosting provider can observe requests for static files and connection metadata (e.g. IP and user agent), even though workspace content remains in the browser.
- The feature labeled "Local analysis" performs deterministic word/checklist statistics, **not AI inference**.
- No school or child pilot is authorized. Separate institutional approval, privacy assessments, safeguarding and security tests are required.

## Security model
All secrets are derived in the browser. The hosting server stores no projects, no account passwords and no API keys. Project ciphertext is authenticated with the account and project ID as AES-GCM associated data. Cryptographic verification errors fail closed. A service worker caches the app shell, not remote files or workspace data. No external code, analytics, fonts or CDN assets.

## Testing
- Owner-only private instance tested with Chromium CDP: create two local profiles, AES-GCM ciphertext at rest, wrong password rejected, persistent project after reload, deterministic local Web Worker, and offline reload.
- Encrypted export validated with no plaintext.
- Encrypted backup exported from Surface and restored successfully on MacBook with the original test passphrase and exact synthetic project content.
- Public GitHub Pages deployment must be verified independently after publication.

## Privacy
See [privacy.html](./privacy.html).

## Source and deployments
Static file artifacts are publishable independently of the FinBridge private admin Jarvis network. No LMint admin URLs, tokens or repositories are included. Do not add privileged agent endpoints to this repository.

## Release gates
Adult informational pilot: separate public static origin permitted after smoke testing.
School and children: closed.
Arbitrary remote shell/coding agents: closed.
