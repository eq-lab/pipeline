# Issue #1155: connect-wallet flow — terms agreement first, then wallet selection

Source: https://github.com/eq-lab/pipeline/issues/1155
Figma: review annotation `2999:9248` on chooser screenshot `2999:8573` ("Исправить флоу — Соглашение с условиями; Выбор кошелька для подключения").

## Scope

The annotation's flow — (1) terms agreement, (2) wallet selection — is already the shipped architecture: every `useConnectModal().open()` entry routes through the `WalletGateProvider` terms gate (`FirstConnectionModal`) before the designed two-pane `ConnectWalletModal` (Figma `2858:57637`), since #646 (2026-06-18); the per-chain `connect()` hooks carry the same gate. The review screenshot shows the pre-#558 bare "Connect EVM / Connect Stellar" `ConnectChooserModal` — a stale staging build (the same pattern as #1148/#1190).

Remaining work: **delete the dead `ConnectChooserModal`** (zero consumers besides its own test) so the flagged UI cannot resurface, and record the verification.

## Assumptions and Risks

- Deletion safety verified by grep: only the component file and its test reference it; no spec references.

## Open Questions

_None_

## Implementation Steps

1. Delete `packages/frontend/src/components/ConnectChooserModal.tsx` and `ConnectChooserModal.test.tsx`.
2. Issue comment with the flow verification (entry → gate → picker, commit refs).
3. Gates: lint, tsc, tests, build.

## Test Strategy

Existing `ConnectModalProvider.test.tsx` covers the gate ordering; full frontend suite must stay green after the deletion.

## Docs to Update

None — the chooser was never spec'd; the connect flow's gate ordering is already documented in `ConnectModalProvider`'s header and `dashboard-components.md#connectwalletmodal`.
