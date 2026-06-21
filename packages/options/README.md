# Options Protocol Move Package

Lean Sui Move package foundation for the options protocol described in
[`../../spec/OPTIONS_SMART_CONTRACT.md`](../../spec/OPTIONS_SMART_CONTRACT.md).

Run from this directory:

```bash
sui move build
sui move test
```
## Contract ABI

### buyers onboarding

Examples are given with `packages/test_usdc` coin.

1. Buyer creates vault

```
sui client ptb \
  --move-call 0xcab07792581d56a4194e776cf1dad9ba2e1c55b6775c094c335b2a8ce2a719ba::buyer_vault::create_vault \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC>' \
  --gas-budget 100000000
```

2. Buyer deposits coin into the created vault

```
sui client ptb \
  --move-call 0xcab07792581d56a4194e776cf1dad9ba2e1c55b6775c094c335b2a8ce2a719ba::buyer_vault::deposit \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC>' \
  @<VAULT_ID> \
  @<TEST_USDC_COIN_OBJECT_ID> \
  --gas-budget 100000000
```

Optional if need to close a vault

```
sui client ptb \
  --move-call 0xcab07792581d56a4194e776cf1dad9ba2e1c55b6775c094c335b2a8ce2a719ba::buyer_vault::close_vault \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC>' \
  @<VAULT_ID> \
  --assign withdrawn_coin \
  --transfer-objects "[withdrawn_coin]" @sender \
  --gas-budget 100000000
```
