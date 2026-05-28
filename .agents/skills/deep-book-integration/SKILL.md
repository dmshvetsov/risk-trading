---
name: deep-book-integration
description: Use when integrating with DeepBook Predict on Sui testnet
---

# DeepBook Predict Integration

Use this skill for app or script work that touches DeepBook Predict contracts, the testnet predict-server API, or the workshop transaction flows.

Read [predict-workshop.md](references/predict-workshop.md) when implementing or debugging a specific Predict flow.

## First Checks

- Prefer the repo's existing wrappers before adding new low-level calls: search for `deepbook-predict`, `predictPackageID`, `predictObjectID`, `dusdcPackageID`, and `predict-server`.
- Treat the linked workshop scripts as reference patterns, not production modules to copy whole.
- Default network is `testnet` unless the user explicitly says otherwise.
- Never hard-code workshop sample object IDs into app code; expose manager, oracle, expiry, strike, quantity, and server URL as config, function args, or env vars.

## Implementation Rules

- Use `@mysten/sui/transactions` `Transaction` for PTBs.
- Use current local Sui client/signing helpers when the repo already has them; otherwise follow local `@mysten/sui` SDK patterns.
- Keep human units at API boundaries and scale only at chain-call boundaries:
  - strikes/prices: `1_000_000_000n`
  - DUSDC, PLP, face quantity: `1_000_000n`
- Always validate inputs before signing: manager id present, direction is `up` or `down`, lower strike is less than higher strike, and coin balances cover top-up/supply/withdraw amounts.
- When spending DUSDC or PLP coins, fetch owned coins, merge them into a primary coin when needed, then split the exact amount.
- Request transaction execution with useful options for debugging: `showEffects`, `showEvents`, and `showObjectChanges` when created objects matter.
- After execution, check `result.effects?.status.status === "success"` before reading events or object changes.

## Predict Server

Default server: `https://predict-server.testnet.mystenlabs.com` prefer to use `PREDICT_SERVER` variable over this URL literal string;

Use it for read-only market and portfolio UX:
- `/status` health status
- `/predicts/{predictObjectId}/oracles` list of Oracles that can be used to open and close ABOVE/BELOW positions or RANGE positions (binary options)
- `/oracles/{oracleId}/state` single oracle data
- `/managers/{managerId}/summary`
- `/managers/{managerId}/positions/summary`
- `/ranges/minted?manager_id={managerId}`
- `/ranges/redeemed?manager_id={managerId}`
- `/managers/{managerId}/pnl?range=ALL`

## Sources

The source pattern is MystenLabs `deepbookv3`, branch `tlee/predict-workshop`, directory `scripts/transactions/predict_workshop`.

