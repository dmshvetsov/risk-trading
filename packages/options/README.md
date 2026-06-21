# Options Protocol Move Package

Lean Sui Move package foundation for the options protocol described in
[`../../spec/OPTIONS_SMART_CONTRACT.md`](../../spec/OPTIONS_SMART_CONTRACT.md).

Run from this directory:

```bash
sui move build
sui move test
```
## Contract ABI

Current testnet package id:
`0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4`

Current admin cap:
`0x9c00d0a5a3842f1076eb6f3fccfe86740a82272a4d532d93daa92d359290f89a`

Current `BTC / tUSDC / tBTC` market object id:
`0xf4f1333e5cb033fb9f29d85a0992db7ae9f6c45d7a2a0ef3a0153ef52d61ac3d`

### buyers onboarding

Examples are given with `packages/test_usdc` coin.

1. Buyer creates vault

```
sui client ptb \
  --move-call 0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4::buyer_vault::create_vault \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC>' \
  --gas-budget 15000000
```

2. Buyer deposits coin into the created vault

```
sui client ptb \
  --move-call 0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4::buyer_vault::deposit \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC>' \
  @<VAULT_ID> \
  @<TEST_USDC_COIN_OBJECT_ID> \
  --gas-budget 15000000
```

Optional if need to close a vault

```
sui client ptb \
  --move-call 0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4::buyer_vault::close_vault \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC>' \
  @<VAULT_ID> \
  --assign withdrawn_coin \
  --transfer-objects "[withdrawn_coin]" @sender \
  --gas-budget 15000000
```

### creating a pair for options

Before option can be underwritten by sellers a `Market` object must be created. For example a `testBTC` base coin and `testUSDC` quote coin pair with a Pyth `Crypto.BTC/USD` oracle with feed id `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` for the price tracking.

```
sui client ptb \
  --move-call 0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4::market::create_market \
  '<QUOTE_COINT_TYPE>, <BASE_COIN_TYPE>' \
  @0x9c00d0a5a3842f1076eb6f3fccfe86740a82272a4d532d93daa92d359290f89a \
  '<ORACLE_BASE_COINT_TRACKING_NAME>' \
  '<ORACLE_NAME>' \
  'vector[<FEED_BYTE_0>u8, <FEED_BYTE_1>u8, <FEED_BYTE_2>u8]' \
  <QUOTE_DECIMALS>u8 \
  <BASE_DECIMALS>u8 \
  <STRIKE_SCALE>u64 \
  <MAX_OPERATIONAL_FEE_BPS>u64 \
  --gas-budget 15000000
```


```
sui client ptb \
  --move-call 0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4::market::create_market \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC, 0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e::test_btc::TEST_BTC>' \
  @0x9c00d0a5a3842f1076eb6f3fccfe86740a82272a4d532d93daa92d359290f89a \
  '"BTC"' \
  '"pyth"' \
  'vector[230u8, 45u8, 246u8, 200u8, 180u8, 168u8, 95u8, 225u8, 166u8, 125u8, 180u8, 77u8, 193u8, 45u8, 229u8, 219u8, 51u8, 15u8, 122u8, 198u8, 107u8, 114u8, 220u8, 101u8, 138u8, 254u8, 223u8, 15u8, 74u8, 65u8, 91u8, 67u8]' \
  6u8 \
  8u8 \
  1000000u64 \
  500u64 \
  --gas-budget 15000000
```

Note that this command set a max operations fee 5%, in basis points, that will be taken in basis points from a buyer's offered premium to a seller.

### creating an options-series

To star underwrite specific strike, expiry, put/call option it must have a `Series` object for `BTC / tUSDC / tBTC` `Market` object.

```
sui client ptb \
  --move-call 0xb955fddbc6a8a2ebb39c8d2b38c9dcbb21e5148458470221bc811de674ab4ee4::series::create_series \
  '<0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC, 0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e::test_btc::TEST_BTC>' \
  @0xf4f1333e5cb033fb9f29d85a0992db7ae9f6c45d7a2a0ef3a0153ef52d61ac3d \
  2u8 \
  5900000000000u64 \
  1785456000000u64 \
  @0x6 \
  --gas-budget 100000000
```
