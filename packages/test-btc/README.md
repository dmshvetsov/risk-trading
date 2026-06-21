# testBTC Move Package

Simple development coin for Sui testnet.

Metadata:

- `name`: `testBTC`
- `symbol`: `tBTC`
- `decimals`: `8`

Run commands from this directory:

```bash
cd packages/test-btc
```

## Build and test

Use the testnet build env:

```bash
sui move build --build-env testnet
sui move test --build-env testnet
```

## Deploy to testnet

1. Make sure your Sui client is using testnet:

```bash
sui client switch --env testnet
```

2. Publish the package:

```bash
sui client publish --json
```

3. Save these values from the publish output:

- `packageId`: the published package id
- `TreasuryCap<test_btc::test_btc::TEST_BTC>` object id
- `CoinMetadata<test_btc::test_btc::TEST_BTC>` object id

After publish, the publisher address owns the treasury cap. The metadata object is frozen.

## Mint tokens

Use the `mint_and_transfer` entry function. This mints `amount` and sends the coin to `recipient`.

```bash
sui client call \
  --package 0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e \
  --module test_btc \
  --function mint_and_transfer \
  --args <TREASURY_CAP_ID> <AMOUNT> <RECIPIENT_ADDRESS> \
  --gas-budget 10000000
```

Example:

```bash
sui client call \
  --package 0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e \
  --module test_btc \
  --function mint_and_transfer \
  --args 0x44fddd71882a4f35fcb10f90f2b97ee94ede2a6914691445cafddf238ce2744e 100000000 @xa \
  --gas-budget 10000000
```

`100000000` means `1.0 tBTC` because the coin uses `8` decimals.

## Burn tokens

Burn needs:

- the treasury cap id
- a `tBTC` coin object id owned by the caller

```bash
sui client call \
  --package 0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e \
  --module test_btc \
  --function burn \
  --args 0x44fddd71882a4f35fcb10f90f2b97ee94ede2a6914691445cafddf238ce2744e <COIN_ID> \
  --gas-budget 10000000
```

If your balance is split across many `tBTC` coin objects, merge them first or burn one object at a time.
