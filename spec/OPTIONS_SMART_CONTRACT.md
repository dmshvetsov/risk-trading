# Options Smart Contract Specification

## Scope

This document specifies the on-chain smart contract design for European, physically settled options on Sui.

The contract design uses:
- transferable semi-fungible long option objects with quantity,
- non-transferable seller vault records,
- a shared margin pool,
- Pyth expiry price finalization,
- manual holder exercise within a fixed exercise window,
- PTB-composable flash-loan exercise.

This document does not specify RFQ servers, market-maker APIs, web UI, indexing, or off-chain quote routing.

## Normative Language

`MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `MAY`, and `OPTIONAL` are normative terms.

## Core Terms

- `BaseCoin`: the physically delivered asset coin type, for example `SUI`, `DEEP`, `WBTC`, or another wrapped BTC coin.
- `QuoteCoin`: the cash/strike/premium coin type, for example `USDC`.
- `OracleBase`: the asset represented by the Pyth feed, for example `BTC` even when `BaseCoin` is `WBTC`.
- `Market`: one deployed market instance for one `OracleBase / QuoteCoin / BaseCoin` combination.
- `Series`: one option series in a market, identified by option type, strike, and expiry.
- `Call`: holder pays `QuoteCoin` strike cash and receives `BaseCoin`.
- `Put`: holder delivers `BaseCoin` and receives `QuoteCoin` strike cash.
- `LongToken`: transferable semi-fungible option object with a `series_id` and `quantity`.
- `SellerVault`: non-transferable seller short-position accounting record for one seller and one series.
- `MarginPool`: shared custody object that holds all `BaseCoin` and `QuoteCoin` collateral and exercise proceeds for the market.

## Market Model

Each market MUST support exactly one `OracleBase / QuoteCoin / BaseCoin` combination.

Examples:
- `SUI / USDC / SUI`
- `DEEP / USDC / DEEP`
- `BTC / USDC / WBTC`
- `BTC / USDC / other_wrapped_btc`

Different wrapped versions of the same oracle asset MUST be different markets. A `BTC / USDC / WBTC` long token MUST NOT merge with a `BTC / USDC / other_wrapped_btc` long token.

The market MUST store:
- Pyth feed id for `OracleBase / QuoteCoin`,
- base coin decimals,
- quote coin decimals,
- strike scale,
- admin address or admin capability,
- fee recipient,
- pause flag,
- margin pool id,
- supported asset identity.

The contract MUST reject operations for unsupported coin types.

## Series Lifecycle

A series MUST contain:
- unique `series_id`,
- option type: `CALL` or `PUT`,
- `strike_price`,
- `expiry_ms`,
- `exercise_window_end_ms = expiry_ms + 2 hours`,
- total short quantity,
- total exercised quantity,
- stored Pyth settlement price,
- settlement price publish time,
- settlement status,
- cumulative exercise proceeds accounting,
- seller vault records keyed by seller address.

Series states:
- `Open`: created and not expired.
- `ExpiredPendingPrice`: expiry reached, price not finalized.
- `PriceFinalized`: expiry price stored.
- `ExerciseClosed`: exercise window ended.

Exercise MUST be allowed only when:
- series price is finalized,
- current time is `>= expiry_ms`,
- current time is `<= exercise_window_end_ms`,
- the series is ITM.

An ITM call is `settlement_price > strike_price`.

An ITM put is `settlement_price < strike_price`.

ATM and OTM options MUST NOT be exercisable.

Unexercised long tokens expire worthless after `exercise_window_end_ms`.

## Series Creation

Series creation MUST be permissionless.

The contract MUST enforce:
- expiry is in the future,
- strike is greater than zero,
- option type is valid,
- market coin types are supported,
- no duplicate series exists for the same market, option type, strike, and expiry.

The UI MAY guide users to standard weekly and monthly expiries, but the contract MUST NOT depend on UI-only expiry helpers.

## Long Token Model

Long option tokens MUST be Sui-owned objects, not PAS assets and not clawback assets.

Each `LongToken` MUST contain:
- object id,
- market id,
- series id,
- option type,
- strike,
- expiry,
- quantity.

Long tokens MUST be freely transferable by their owner.

Long tokens MUST support:
- `split(token, quantity) -> LongToken`,
- `merge(target, source)`,
- partial exercise by splitting or reducing quantity,
- full exercise by consuming the token object.

`merge` MUST require identical:
- market id,
- series id,
- option type,
- strike,
- expiry.

The protocol MUST NOT be able to force-burn long tokens from user wallets. Holder action is REQUIRED to exercise.

## Seller Vault Model

The contract MUST use one non-transferable `SellerVault` record per seller and series.

The `SellerVault` SHOULD be stored as a dynamic field under the shared series object, keyed by seller address. It MUST NOT be an owned object that requires seller signature for settlement, because seller settlement MUST be permissionless after the exercise window.

Each `SellerVault` MUST store:
- seller address,
- series id,
- short quantity,
- collateral quantity,
- settlement status,
- accounting snapshot values if index-based accounting is used.

The seller vault replaces a transferable short option token. It records how much the seller wrote and determines what the seller receives after expiry.

Sellers MUST NOT receive transferable writer tokens in V1.

## Margin Pool

Each market MUST have one shared `MarginPool`.

The margin pool MUST hold aggregate `BaseCoin` and `QuoteCoin` balances for all series in the market.

The controller/accounting layer MUST track which series and seller vaults are entitled to which portions of the shared balances. Physical coin balances in the pool MUST NOT be treated as per-seller segregated balances.

The margin pool MUST track accounted balances so admin recovery can only recover excess or dust that is not reserved for active or unsettled positions.

## Underwriting

Underwriting creates long tokens for a buyer and records a seller short obligation.

For a covered call:
- seller deposits `BaseCoin` collateral equal to the option quantity,
- buyer pays premium in `QuoteCoin`,
- contract mints/transfers `LongToken` to buyer,
- seller vault short quantity increases.

For a cash-secured put:
- seller deposits `QuoteCoin` collateral equal to `strike_payment(quantity)`,
- buyer pays premium in `QuoteCoin`,
- contract mints/transfers `LongToken` to buyer,
- seller vault short quantity increases.

Seller collateral MUST be fully collateralized. V1 MUST NOT support naked, undercollateralized, or cross-margin positions.

V1 MUST NOT support:
- seller collateral top-up after underwriting,
- seller short reduction before expiry,
- seller excess collateral withdrawal before expiry.

Premium and fee handling:
- buyer pays `premium_total` in `QuoteCoin`,
- `protocol_fee` is deducted from `premium_total`,
- seller receives `premium_total - protocol_fee`,
- protocol fee is transferred to the fee recipient or treasury.

`protocol_fee` MUST NOT exceed `premium_total`.

The market MAY enforce an immutable or admin-configured maximum fee basis points. If present, underwriting MUST reject fees above that cap.

## Strike Payment Calculation

The contract MUST provide deterministic conversion between base quantity and quote strike payment.

For calls, holder quote payment MUST be:

`quote_required = ceil(base_quantity * strike_price * quote_scale / base_scale / strike_scale)`

For puts, seller quote collateral and holder quote payout MUST use the same formula.

Rounding MUST favor solvency:
- holder payment for calls MUST round up,
- put collateral requirement MUST round up,
- holder payout for puts MUST NOT exceed locked quote collateral.

## Price Finalization

The contract MUST use Pyth only to determine ITM/OTM status.

The contract MUST NOT use the oracle price to calculate physical settlement amounts.

Anyone MAY finalize a series price after expiry.

The accepted Pyth price MUST satisfy:
- publish time is after or equal to `expiry_ms`,
- publish time is within a bounded first-after-expiry window,
- price is positive,
- feed id matches the market feed id.

Once stored, the settlement price MUST be immutable.

V1 cannot prove "first after expiry" if multiple valid Pyth updates inside the bound are available unless the oracle exposes a verifiable sequence. Therefore V1 MUST implement "first valid bounded update accepted by the contract". The bound MUST be an immutable market constant and SHOULD be short enough to leave most of the 2-hour exercise window available.

If no valid bounded price is finalized, exercise MUST remain blocked and admin recovery rules MUST be used only after a conservative recovery delay.

## Manual Physical Exercise

Exercise is holder-initiated.

The holder MUST provide:
- a `LongToken` or split portion of a `LongToken`,
- required payment asset,
- clock object,
- finalized series.

### Covered Call Exercise

For an ITM call:
- holder burns or reduces call `LongToken` quantity,
- holder pays `QuoteCoin` strike cash,
- margin pool transfers `BaseCoin` to holder,
- series records exercised quantity,
- series records quote proceeds received.

### Cash-Secured Put Exercise

For an ITM put:
- holder burns or reduces put `LongToken` quantity,
- holder delivers `BaseCoin`,
- margin pool transfers `QuoteCoin` strike cash to holder,
- series records exercised quantity,
- series records base proceeds received.

Partial exercise MUST be supported.

Exercise MUST abort if:
- series price is not finalized,
- current time is outside exercise window,
- option is not ITM,
- payment asset is insufficient,
- long token series does not match,
- quantity is zero,
- quantity exceeds token quantity,
- margin pool does not have enough collateral.

## Flash-Loan Exercise

Flash-loan exercise MUST be supported through PTB composition.

The core exercise functions MUST be designed so returned proceeds can be used in the same PTB to repay a flash loan or swap route.

For calls, a PTB MAY:
- borrow `QuoteCoin`,
- call `exercise_call`,
- receive `BaseCoin`,
- swap part of `BaseCoin` to `QuoteCoin`,
- repay borrowed `QuoteCoin`,
- transfer remainder to holder.

For puts, a PTB MAY:
- borrow `BaseCoin`,
- call `exercise_put`,
- receive `QuoteCoin`,
- swap part of `QuoteCoin` to `BaseCoin`,
- repay borrowed `BaseCoin`,
- transfer remainder to holder.

The core options contract SHOULD NOT hard-code one lending protocol or DEX. Provider-specific helpers MAY be separate adapter modules.

Flash exercise MUST be atomic: if borrow, exercise, swap, or repay fails, the whole PTB MUST fail.

## Seller Settlement

Seller settlement MUST be permissionless after `exercise_window_end_ms`.

Anyone MAY settle a seller vault, but proceeds MUST be transferred only to the seller address stored in the vault.

Seller settlement MUST close the seller vault and return residual assets according to actual exercised quantity for the series.

Because long tokens are fungible by series and are not matched to seller vaults, actual physical exercises MUST be allocated across seller vaults pro-rata by each vault's short quantity.

For calls, a seller receives:
- unexercised portion in `BaseCoin`,
- exercised portion proceeds in `QuoteCoin`.

For puts, a seller receives:
- unexercised portion in `QuoteCoin`,
- exercised portion proceeds in `BaseCoin`.

Seller settlement MUST NOT require all long token holders to exercise. Unexercised long tokens are worthless after the exercise window.

Seller settlement MUST abort if:
- exercise window has not ended,
- vault already settled,
- series does not exist,
- settlement arithmetic would overdraw the margin pool.

Rounding dust MUST remain in the margin pool and MAY be recoverable only through admin recovery after the recovery delay.

## Accounting Invariant

At all times, the margin pool's accounted balances MUST be greater than or equal to the sum of active obligations required by all open and unsettled series.

For each series:
- `total_exercised_quantity <= total_short_quantity`,
- exercised long token quantity MUST be burned or removed,
- seller vault short quantities MUST sum to series total short quantity, excluding settled vaults only after their obligations are paid,
- pool transfers MUST never exceed accounted balances.

The contract MUST use checked arithmetic.

Quantity and payment calculations SHOULD use `u128` or wider intermediate arithmetic where needed.

## Transferability and Composability

Long tokens MUST be transferable outside the protocol.

The protocol MUST NOT assume it can discover all holders.

There is no automatic exercise of wallet-held long tokens. Holders must exercise within the exercise window or lose the option value.

The contract MUST emit enough events for wallets, indexers, and keepers to discover:
- created series,
- underwritten positions,
- long token mint/split/merge/exercise,
- price finalization,
- seller vault settlement.

## Events

The contract MUST emit events for:

`MarketCreated`
- market id,
- oracle base symbol or id,
- quote coin type,
- base coin type,
- Pyth feed id.

`SeriesCreated`
- series id,
- market id,
- option type,
- strike,
- expiry.

`Underwritten`
- series id,
- seller,
- buyer,
- quantity,
- collateral deposited,
- premium total,
- protocol fee,
- long token id.

`PriceFinalized`
- series id,
- Pyth feed id,
- settlement price,
- publish time.

`LongTokenSplit`
- series id,
- source token id,
- new token id,
- split quantity.

`LongTokenMerged`
- series id,
- target token id,
- source token id,
- merged quantity.

`Exercised`
- series id,
- holder,
- option type,
- quantity,
- input asset amount,
- output asset amount.

`SellerVaultSettled`
- series id,
- seller,
- short quantity,
- base paid,
- quote paid.

`Paused`
- admin.

`Unpaused`
- admin.

`AdminRecovered`
- admin,
- asset type,
- amount,
- recipient,
- reason code.

## Pause

The contract MUST support one global pause.

When paused:
- series creation MUST be disabled,
- underwriting MUST be disabled,
- admin recovery MAY be enabled,
- long token split and merge SHOULD remain enabled,
- price finalization SHOULD remain enabled,
- exercise and seller settlement SHOULD remain enabled unless the implementation has a known critical bug in those paths.

Pause authority MUST be held by an admin capability.

## Admin Recovery

Admin recovery MUST be limited to:
- excess balances not reserved by accounting,
- rounding dust after a conservative recovery delay,
- unsupported objects or coins accidentally sent to auxiliary admin-controlled objects, if technically possible.

Admin recovery MUST NOT withdraw collateral required for open, exercisable, or unsettled series.

Admin recovery MUST emit `AdminRecovered`.

## Public Function Surface

The contract SHOULD expose at least:

- `create_market`
- `create_series`
- `underwrite_call`
- `underwrite_put`
- `split_long`
- `merge_long`
- `finalize_series_price`
- `exercise_call`
- `exercise_put`
- `settle_seller_vault`
- `pause`
- `unpause`
- `admin_recover_excess`

Exercise functions SHOULD be PTB-friendly and SHOULD return output coins where Sui function rules allow. Entry wrappers MAY transfer outputs directly to the caller.

## Non-Goals For V1

V1 MUST NOT implement:
- American exercise,
- cash settlement,
- automatic clawback exercise,
- PAS assets,
- naked margin,
- cross margin,
- seller writer tokens,
- seller collateral withdrawal before expiry,
- seller close by burning longs before expiry,
- automatic holder discovery,
- built-in DEX routing,
- built-in lending protocol dependency.

## Main Design Tradeoffs

The design chooses seller vault records over transferable writer tokens to keep seller accounting simple and settlement permissionless.

The design chooses transferable long SFT objects so options remain composable and mergeable by series.

The design chooses a shared margin pool so fungible long tokens do not need buyer-seller matching.

The cost of this design is that physically exercised quantity must be allocated to seller vaults pro-rata by short quantity. This is unavoidable unless the protocol uses non-fungible long positions, assignment queues, or per-series writer-share vaults.

