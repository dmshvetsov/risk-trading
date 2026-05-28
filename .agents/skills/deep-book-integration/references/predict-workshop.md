# Predict Workshop Transaction Patterns

These patterns come from MystenLabs `deepbookv3` branch `tlee/predict-workshop`, `scripts/transactions/predict_workshop`.

## Shared Constants

- `network`: `testnet`
- `CLOCK`: `0x6`
- `DUSDC_TYPE`: `${dusdcPackageID[network]}::dusdc::DUSDC`
- `PLP_TYPE`: `${predictPackageID[network]}::plp::PLP`
- price scale: `1_000_000_000n`
- DUSDC/PLP scale: `1_000_000n`

Use project constants for:
- `predictPackageID[network]`
- `predictObjectID[network]`
- `dusdcPackageID[network]`

## Create Manager

Call:

```ts
tx.moveCall({
  target: `${predictPackageID[network]}::predict::create_manager`,
  arguments: [],
});
```

Execute with `showEffects` and `showObjectChanges`, then find the created object whose type ends with `::predict_manager::PredictManager`.

## Deposit DUSDC Into Manager

Fetch DUSDC coins for the active address. Merge all coins into the first coin, split the scaled top-up amount, then call:

```ts
tx.moveCall({
  target: `${predictPackageID[network]}::predict_manager::deposit`,
  typeArguments: [DUSDC_TYPE],
  arguments: [tx.object(managerId), depositCoin],
});
```

This deposit is commonly included in the same PTB before minting.

## List Markets

Use predict-server:

```ts
GET /status
GET /predicts/{predictObjectID.testnet}/oracles
GET /oracles/{oracleId}/state
```

Tradeable oracle filter:
- `status === "active"`
- `expiry > Date.now()`
- `settlement_price == null`

Display oracle id, underlying, expiry, spot/forward, min strike, and tick size.

## Mint Directional Position

Inputs: `managerId`, `oracleId`, `expiry`, `strikeDollars`, `direction`, `quantityDollars`, optional `topupDollars`.

Build key:

```ts
const key = tx.moveCall({
  target: `${predictPackageID[network]}::market_key::${direction === "up" ? "up" : "down"}`,
  arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strikeDollars * PRICE_SCALE)],
});
```

Mint:

```ts
tx.moveCall({
  target: `${predictPackageID[network]}::predict::mint`,
  typeArguments: [DUSDC_TYPE],
  arguments: [
    tx.object(predictObjectID[network]),
    tx.object(managerId),
    tx.object(oracleId),
    key,
    tx.pure.u64(quantityDollars * DUSDC_SCALE),
    tx.object(CLOCK),
  ],
});
```

Success event suffix: `::predict::PositionMinted`.

## Redeem Directional Position

Build the same market key. Choose target:
- live oracle: `predict::redeem`
- settled oracle: `predict::redeem_permissionless`

Call shape:

```ts
tx.moveCall({
  target: `${predictPackageID[network]}::predict::${settled ? "redeem_permissionless" : "redeem"}`,
  typeArguments: [DUSDC_TYPE],
  arguments: [
    tx.object(predictObjectID[network]),
    tx.object(managerId),
    tx.object(oracleId),
    key,
    tx.pure.u64(quantityDollars * DUSDC_SCALE),
    tx.object(CLOCK),
  ],
});
```

Success event suffix: `::predict::PositionRedeemed`.

## Mint Range

Validate `lowerStrikeDollars < higherStrikeDollars`. Build key:

```ts
const key = tx.moveCall({
  target: `${predictPackageID[network]}::range_key::new`,
  arguments: [
    tx.pure.id(oracleId),
    tx.pure.u64(expiry),
    tx.pure.u64(lowerStrikeDollars * PRICE_SCALE),
    tx.pure.u64(higherStrikeDollars * PRICE_SCALE),
  ],
});
```

Mint:

```ts
tx.moveCall({
  target: `${predictPackageID[network]}::predict::mint_range`,
  typeArguments: [DUSDC_TYPE],
  arguments: [
    tx.object(predictObjectID[network]),
    tx.object(managerId),
    tx.object(oracleId),
    key,
    tx.pure.u64(quantityDollars * DUSDC_SCALE),
    tx.object(CLOCK),
  ],
});
```

Success event suffix: `::predict::RangeMinted`.

## List Positions

Use predict-server:
- `/managers/{managerId}/summary`
- `/managers/{managerId}/positions/summary`
- `/ranges/minted?manager_id={managerId}`
- `/ranges/redeemed?manager_id={managerId}`

For ranges, reconstruct open quantity by keying events as `oracle_id|expiry|lower_strike|higher_strike`, adding minted quantities and subtracting redeemed quantities.

## LP Supply

Fetch DUSDC, merge/split the supply amount, call:

```ts
const lpCoin = tx.moveCall({
  target: `${predictPackageID[network]}::predict::supply`,
  typeArguments: [DUSDC_TYPE],
  arguments: [tx.object(predictObjectID[network]), supplyCoin, tx.object(CLOCK)],
});
tx.transferObjects([lpCoin], tx.pure.address(address));
```

Success event suffix: `::predict::Supplied`; created object type includes `::plp::PLP`.

## LP Withdraw

Use explicit `PLP_COIN` or discover all owned PLP coins. Merge as needed, optionally split amount, then call:

```ts
const dusdcOut = tx.moveCall({
  target: `${predictPackageID[network]}::predict::withdraw`,
  typeArguments: [DUSDC_TYPE],
  arguments: [tx.object(predictObjectID[network]), plpCoinArg, tx.object(CLOCK)],
});
tx.transferObjects([dusdcOut], tx.pure.address(address));
```

Success event suffix: `::predict::Withdrawn`.
