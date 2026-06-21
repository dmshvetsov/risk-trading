# testUSDC Move Package

Simple development coin for Sui testnet.

Metadata:

- `name`: `testUSDC`
- `symbol`: `tUSDC`
- `decimals`: `6`

Run commands from this directory:

```bash
cd packages/test-usdc
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
sui client publish --build-env testnet --gas-budget 100000000 --json
```

3. Save these values from the publish output:

- `packageId`: the published package id
- `TreasuryCap<test_usdc::test_usdc::TEST_USDC>` object id
- `CoinMetadata<test_usdc::test_usdc::TEST_USDC>` object id

After publish, the publisher address owns the treasury cap. The metadata object is frozen.

## Mint tokens

Use the `mint_and_transfer` entry function. This mints `amount` and sends the coin to `recipient`.

```bash
sui client call \
  --package <PACKAGE_ID> \
  --module test_usdc \
  --function mint_and_transfer \
  --args <TREASURY_CAP_ID> <AMOUNT> <RECIPIENT_ADDRESS> \
  --gas-budget 10000000
```

Example:

```bash
sui client call \
  --package 0xPACKAGE \
  --module test_usdc \
  --function mint_and_transfer \
  --args 0xTREASURY_CAP 1000000 0xRECIPIENT \
  --gas-budget 10000000
```

`1000000` means `1.0 tUSDC` because the coin uses `6` decimals.

## Burn tokens

Burn needs:

- the treasury cap id
- a `tUSDC` coin object id owned by the caller

```bash
sui client call \
  --package <PACKAGE_ID> \
  --module test_usdc \
  --function burn \
  --args <TREASURY_CAP_ID> <COIN_ID> \
  --gas-budget 10000000
```

If your balance is split across many `tUSDC` coin objects, merge them first or burn one object at a time.
