# Product Specification

Purpose: define specification of all parts of option trading on-chain protocol with off-chain application user interface and off-chain server infrastructure, where assets settlement logic implemented in the on-chain protocol and taker/maker logic in the off-chain users facing web application (aka client) and server infrastructure.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and `OPTIONAL` in this document are to be interpreted as described in RFC 2119.

## Product Language

This document uses `./DOMAIN-LANGUAGE.md` as way to describe option trading specific parts of the product used by business and technical members.

## What the protocol does

- the protocol facilitates trades between two parties, two types of users, takers "DeFi participants" and makers "Market Makers"
  - takers willing to receive premium as immediate yield on stable coin "cash" (for example $USDT and $USDC) or supported by protocol assets for example $WBTC or $SUI
    - by making "cash" deposit until next Friday 8:00 UTC or until last Friday 8:00 UTC of the month with obligation to exchange the deposit "cash" for chosen by taker "asset" if on-chain oracle price of the "asset" will fall below a beforehand specified price at the end of the period of this contract, this contract is known as "cash secured put" contract
    - by making "asset" deposit until next Friday 8:00 UTC or until last Friday 8:00 UTC of the month with obligation to exchange the deposit "asset" for chosen by taker "cash" token if on-chain oracle price of the "asset" will be above a beforehand specified price at the end of the period of this contract, known as "covered call" contract
  - makers provide quote on how much a maker will pay premium for takers for "cash secured put" or "covered call" contract, provided quotes terms acts as obligation to execute quote to purchase such contract between from taker
  - makers willing
    - receive specified in the contract amount of "cash" tokens for specified in the contract "asset" at beforehand agreed price and amount of the "asset" at the end of the period of the contract, know as "cash secured put"
    - receive specified in the contract amount of "asset" for specified in the contract amount of "cash" tokens at beforehand agreed price at the end of the period of the contract, know as "covered call"
  - makers exercise their options tokens, otherwise they expires worthless withing predefined time

Process in high-level flow for takers:
- taker visits the protocol web application (UI)
- taker picks contract type "covered call" or "cash secured put" and contract expiration date weekly or monthly
- taker use the protocol web application to receive best quote from integrated to the protocol makers for given contract type call/put, asset collateral, cash token and expiration date
- taker agrees to underwrite a option token with the best provided quote and sign a blockchain transaction and sends it to the protocol server
- protocol server broadcasts it to Sui Blockchain taker receives premium and maker receives option contact token

Process in high-level flow for makers:
- maker integrates their API to the protocol server by implementing an endpoint(s) that returns quotes for takers
- maker deposits minimal cash $100000 in total to participate in the protocol, makers can deposit more but must hold the minimal amount to participate in the protocol and receive RFQs
- the protocol deduct deposited "cash" tokens to underwrite option contracts on behalf of taker, pay premium to taker on behalf of maker and take the protocol fee from the premium to the protocol treasury
- at any point of time maker can withdraw current deposited "cash" tokens that exceeds the minimal market maker cash required to participate in the protocol activity
- within 1 hour after expiry makers deposits exact amount of cash tokens required to exercise their existing covered call tokens and amount of assets required to exercise their existing cash secured put tokens and option tokens
- the protocol exercise options contracts 
- maker withdraw assets and cash for exercised positions and for positions expired worthless, makers may keep cash and assets in the protocol

## Technical Stack

- Sui blockchain, and Move Language for smart contracts,
- Cloudflare (workers, durable object, cache API, cron, queues) written in Rust language
- Cloudflare D1 database

## Option implementation

On-chain option contract consist of:
- underlying assets with an oracle spot price
- collateral asset
  - can be the same underlying asset like $SUI same underlying and collateral
  - or liquid version $sSUI as collateral for $SUI underlying
  - or wrapped version $WBTC as collateral for $BTC underlying

### Token

Each option series grouped by the same expiration, strike, and call or put type implemented by a Semi-fungible token (SFT). SFT groups the same option series of the same base/quote (asset collateral token/cash token) in one smart contract. For example `BTC-USDT-WBTC`, `BTC-USDC-WBTC`, `BTC-USDC-HBTC`, `SUI-USDC-SUI` are all separate smart contracts and a such contract has many semi-fungible tokens that represents option series.

Token smart contract MUST implement join and split function that allows to join other object balance to the SFT object balance, RECOMMENDED to use `sui::balance` for implementation.

### Ticker schema

`<oracle base symbol 3-5 chars>-<oracle quote symbol also used as "cash" token 3-5 chars>-<collateral symbol 3-5 chars>-<DDMMMYY format expiration date>-<strike price either flaoting point number 0. or whole 150 but not both>-<call/put marker C or P char>`

Examples:
- `BTC-USDT-WBTC-5JUN26-75000-C` options uses $BTC price, $USDT quote and "cash" for premium and deposit, $WBTC as collateral in Call option with expiration date 5 June 2026 and strike price 75000 in $USDT
- `BTC-USDT-WBTC-28AUG26-68000-P` options uses $BTC price, $USDT quote and "cash" for premium and deposit, $WBTC as asset in Put option with expiration date 28 August 2026 and with strike price 68000 in $USDT
- `BTC-USDC-HBTC-5JUN26-68000-P` options uses $BTC price, $USDC quote and "cash" for premium and deposit, $HBTC (hashi BTC) as asset in Put option with expiration date 5 June 2026 and with a strike price 68000 in $USDC
- `BTC-USDC-TBTC-5JUN26-1002000-C`
- `SUI-USDC-SUI-5JUN26-0.97-C` options uses $SUI price, $USDC quote for base $SUI and "cash" for premium and deposit, $SUI as collateral
- `SUI-USDC-HASUI-5JUN26-0.72-P`
- `DEEP-USDC-DEEP-5JUN26-0.035-C`

## System Design

### 1. Smart Contracts (on-chain protocol)

- expiration module (european or american style)
- strike and oracle module
- asset/settlement/collateral
  - collateral module (knows about collateral and strike tokens)
  - settlement module (knows to settle physically or in cash)
  - asset transfer module (SUI std lib)
- options logic
  - put option logic module
  - call option logic module

Middleware or Composition of logic, from top external to bottom internal:
1. expiration
1. strike/oracle
1. put/call logic
1. settlement

For example middleware style `EuropeanMid(StrikeMid(PutMid(PhysicalMid))) call (args)` or composition style `PhysicalOption(PutOption(StrikeOption(EuropeanOption(args))))`

Order of middleware or composition components SHOULD wary.

Smart contract design MUST allow compose future modules or replace one module version with another module version.

Smart contracts:
- `EuropeanOption` module, European style, Physical settlement, Option
  - `::underwrite` creates a generic options token
  - `::settle` expires or exercise generic put/call option token
- `PutOption` generic put options module, for handling logic of put options
  - `::underwrite`
  - `::exercise`
  - `::expire`
- `CallOption` generic call options module, for handling logic of call options
  - `::underwrite`
  - `::exercise`
  - `::expire`
- `PhysicalOption` module encapsulates logic of physical settlement of option tokens
- `StikeOption` module encapsulates logic about strike price, in-the-money at-the-money out-the-money logic
- `Maker` for depositing, withdrawing, holding and operating deposited makers funds on behalf makers to pay premium to the user and fees to the protocol
- `Vault` per SFT/maker vault that holds collateral for SFT and to where maker deposits cash or assets and corresponding option tokens to exercise, MUST be owned by the protocol. Vault MUST be deterministic per maker and option series. Its derivation key MUST include maker signer address, collateral token address, cash token address, expiration, strike price, call/put marker, chain, and package id.
- `Treasury` for holding collected fees from facilitating option contracts trading

RECOMMENDED to use `sui::versioned::create` for versioning Sui long term objects that lived without known in advance expiration/burn/deletion date. For options tokens RECOMMENDED to not use `sui::versioned::create` as they are short lived and will be burned (expired) at explicitly know date.

MUST implement escrow shared object for maker to deposit "cash" tokens that will be used to pay premium for issued by maker quotes and agreed by taker

MUST issue following events:
- `EuropeanOption::Underwrite` includes maker's order signature, order hash, option token address, option receiver address, underwriter address, premium paid to taker, put/call, oracle asset base and oracle quote token for the asset, collateral asset (might be different, for example BTC and wBTC or hashi BTC etc), expiration, strike price
- `EuropeanOption::Settle` includes maker's order signature, option token address,
- `Maker::Deposit` includes amount and depositor
- `Maker::Withdrawal` includes amount and withdrawer
- `Treasury::Deposit` includes amount and depositor
- `Treasury::Withdrawal` includes amount and withdrawer

Smart contract(s) MUST stop underwriting options 8 hours before options token expiration, thus to underwrite an option token it must have expiration > 8 hours.

Smart contract(s) MUST verify and if any is not valid or true smart contract(s) MUST abort underwrite transaction atomically:
- maker order signature
- current time on-chain is not later than order `goodTillUnixTs`
- current time on-chain is before option expiration minus 8 hours
- order fields match the derived maker vault
- order hash has not been used in the derived maker vault
- maker available cash to pay premium to taker

On successful underwriting, the contract MUST store `orderHash = blake2b256(bcs(OrderV1))` in the derived maker vault used-order set.

### 2. Server (Off-chain infrastructure)

Implemented as Cloudflare workers.

#### 2.1 CRUD and RFQ Server

Responsible to handle create, read, update, delete actions on the server database that required to facilitate main activity of the protocol explained in `## What the protocol does`

Implemented using Cloudflare Workers infrastructure and written in Rust programming language and `worker-rs` crate.

MUST implement API for:
- request for quote
- user dashboard of sold option contracts open, expired, exercised

MUST use Cloudflare Durable Object as a way to store provided quotes and their expiration.

### How Integration with Market Makers works

Makers API MUST implement endpoint `POST /otp/rfq/quote` to provide time bound contracts quantity bound quotes

Makers API MUST implement endpoint `POST /otp/rfq/order` to provide order

Makers MUST deposit cash to the protocol account for makers created using a EOA, this EOA will be used to sign quotes and pay premiums.

Makers MUST sign quotes with the wallet used to create maker account and deposit cash to pay premium.

Quote MUST include makers wallet that will be receiver of option tokens.

Makers MUST sign order with takers size and taker address. Order signature MUST be submitted on-chain and logged in underwrite event.

Maker `QuoteV1` quotes MUST be treated as off-chain short-lived reusable offers and MUST NOT be used to create option tokens. Maker quotes are reusable until `offerValidUntilUnixTs` or until `offerValidUntilTotalContractsQty` is exhausted. Maker liability starts only after maker signs `OrderV1`.

The same signed quote MAY be used by multiple takers while `offerValidUntilUnixTs` has not passed or `offerValidUntilTotalContractsQty` is not exceeded and the maker protocol account has enough available cash to pay premium and protocol fees. When RFQ server sends a transaction to Broadcaster it MUST deduct order quantity from current quote `offerValidUntilTotalContractsQty`, RFQ MUST not track if transaction was actually broadcasted on-chain thus the server does not guarantees to maker that his quote will be filled right up to `offerValidUntilTotalContractsQty`. RFQ server MUST NOT send more contracts quantity than `offerValidUntilTotalContractsQty` of current quote.

### Signed quote and order messages

JSON in this API is transport format only. Makers MUST NOT sign JSON bytes directly.

Quotes and orders MUST be signed as versioned BCS structs: `QuoteV1` and `OrderV1`. Field order MUST be exactly the order shown in `MakerQuoteV1` and `MakerOrderV1`. String amounts MUST be parsed as base-unit unsigned integers before BCS serialization. Addresses MUST use canonical Sui address bytes. Missing, null, extra, floating-point, or wrongly scaled fields MUST be rejected.

Each signed struct MUST include a `domain` field. Quote domain MUST be `otp:makerquote:v1`. Order domain MUST be `otp:makerorder:v1`.

Signature scheme for v1 MUST be Sui personal-message signing over the BCS bytes with Ed25519 keys. RFQ server MUST verify `QuoteV1` and `OrderV1` signatures. Smart contracts MUST verify `OrderV1` domain, BCS bytes, signer address, and signature before underwriting.

RFQ server MUST send quote to the order endpoint only for maker that created this quote.


```
type QuoteRequest = {
  request: {
    oracleBaseSymbol: string      // for example eBTC
    oracleQuoteSymbol: string     // for example USD
    oracleFeedId: string          // Pyth BTC/USD feed
    collateralTokenAddress: string
    collateralTokenDecimals: number
    cashTokenAddress: string // also will be used to pay premium
    cashTokenDecimals: number
    callPutMarker: 1 | 2 // u8 1: call 2: put
    longShortMarker: 1 | 2 // u8 1: long (buy option) 2: short (sell option)
    strikePriceDecimals: string // uses configured Pyth oracle exponent
    expiryUnixTs: number
    contractsQtyDecimals: string // uses collateralTokenDecimals
    protocolPackageId: string // address of SFT smart contract for base/quote pair
    chainId: 'sui:mainnet' | 'sui:testnet'
  }
}
```

```
type MakerQuoteV1 = {
  domain: 'otp:makerquote:v1'
  quoteId: string; // 36 chars long max
  oracleBaseSymbol: string      // for example eBTC
  oracleQuoteSymbol: string     // for example USD
  oracleFeedId: string          // Pyth BTC/USD feed
  collateralTokenAddress: string // must match quote request
  collateralTokenDecimals: number
  cashTokenAddress: string // must match quote request, also will be used to pay premium
  cashTokenDecimals: number
  callPutMarker: 1 | 2 // u8 1: call 2: put, must match quote request
  longShortMarker: 1 | 2 // u8 1: long (buy option) 2: short (sell option), must match quote request
  strikePriceDecimals: string // uses configured Pyth oracle exponent, must match quote request
  expiryUnixTs: number
  signer: string // EOA wallet that manages deposited cash in the protocol, used to identify from what deposited cash to pay premium, will receive option tokens
  cashPremiumPerContract: string // premium per 1 option contract in premium token decimals, cashTokenAddress is used for premium
  offerValidUntilTotalContractsQtyDecimals: string // must be >= contractsQtyDecimals of the request, uses collateralTokenDecimals
  offerValidUntilUnixTs: number
  makerId: string // uniq maker id created in the protocol database
  protocolPackageId: string // must match quote request
  chainId: 'sui:mainnet' | 'sui:testnet' // must match quote request
}
```

```
type QuoteResponse = {
  quote: MakerQuoteV1
	quoteSignature: string // signature of canonical QuoteV1 BCS bytes
}
```

```
type ExecutionRequest = {
  quote: QuoteResponse['quote']
	quoteSignature: string // signature of canonical QuoteV1 BCS bytes
  contractsQtyDecimals: string // uses collateralTokenDecimals
  takerAddress: string
}
```

```
type MakerOrderV1 = {
  domain: 'otp:makerorder:v1'
  protocolPackageId: string
  takerAddress: string // must match ExecutionRequest.takerAddress
  collateralTokenAddress: string // must match quote request and derived vault
  collateralTokenDecimals: number
  cashTokenAddress: string // must match quote request, also will be used to pay premium
  cashTokenDecimals: number
  chainId: 'sui:mainnet' | 'sui:testnet' // must match quote request
  callPutMarker: 1 | 2 // u8 1: call 2: put, must match quote request
  longShortMarker: 1 | 2 // u8 1: long (buy option) 2: short (sell option), must match quote request
  strikePriceDecimals: string // uses configured Pyth oracle exponent, must match quote request and derived vault
  expiryUnixTs: number
  contractsQtyDecimals: string // uses collateralTokenDecimals
  goodTillUnixTs: number
  cashPremiumPerContract: string // premium per 1 option contract in premium token decimals
  makerId: string // uniq maker id created in the protocol database
  quoteId: string // must match ExecutionRequest.quote.quoteId
  signer: string // EOA wallet address that manages deposited cash in the protocol, used to identify from what deposited cash to pay premium, will receive option tokens
}
```

```
type ExecutionResponse = {
  order: MakerOrderV1
  orderSignature: string // signature of canonical MakerOrderV1 BCS bytes
}
```

`offerValidUntilTotalContractsQty` MUST be tracked by RFQ server and is not validated on-chain.

`orderHash` MUST be `blake2b256(bcs(OrderV1))`. Smart contracts MUST compute `orderHash` from canonical `OrderV1` BCS bytes and MUST NOT trust a caller-provided hash.

#### 2.2 Broadcast Server

Responsible to broadcast off-chain agreed contract between taker and maker to Sui blockchain.

MUST implement API for:
- request for required parameters to build a Sui PTB for takers to underwrite an option contract for a given quote
- request for makers to set their vault to be exercised
- settlement API that can be triggered by Cloduflare Scheduled job (Cron) or manually by an administrator of the protocol Operations team
- submitting transaction on-chain

MUST implement per maker Cloudflare queue that will submit orders to corresponding maker Vault to underwrite options, settle vault, and broadcast any other transaction to the vault. The queue SHOULD broadcast transactions sequentially per maker vault to reduce the chance of concurrent updates and failures on the on-chain vault object.

Broadcast server runs one in-flight tx per maker vault and waits for finality before next transaction.

### 2.3 Web App (Off-chain decentralized application)

User interface for takers and makers.

MUST be mobile fist application.

MUST implement following pages:
- Home / Earn page with supported assets for covered call and cash-secured put contract type with call to action to open an option contract: available expiries, APR range, and call to action to open an option income position
- Option quote builder page for a selected asset and contract type, including strike selection, expiry selection, position size input, collateral requirements, expected premium, calculated APR for the given premium, oracle spot price, expected expiry outcome of the contracts if price stay above equal or below strike. Must request another quote if current expires. Must have a CTA "Deposit and Earn Upfront Premium" that triggers an on-chain transaction.
- Taker dashboard page showing open positions with indication what will happen if expiration and settlement will be now, settled positions, expired positions, pending settlement, with data for position: spot/current oracle price (if open position) otherwise price at expiration, strike, APR, premium received 
- Maker dashboard page showing open positions, ITM/OTM status, required settlement funds, exercise/settlement readiness, button to exercise ITM options after expiration, and settlement history

Taker UI MUST use simple language in terms of immediate premium for "cash secured put" or "covered call". MUST NOT mention of options or derivatives.

Maker UI MUST use professional option trader language.

MUST use Broadcast server to submit transaction on-chain.

MUST use Pyth Hermess client to fetch prices for assets.

## Creating (minting) option tokens (contracts)

The protocol MUST stop underwriting contracts that will have less than 8 hours till expiration.

One option serries can have many tokens. For example there might be X amount of `BTC-USDC-WBTC-5JUN26-75000-C` tokens each with own supply. `BTC-USDC-WBTC-5JUN26-78000-C` is another option series and also can have many tokens each with own supply, `BTC-USDC-WBTC-5JUN26-70000-P`, `BTC-USDC-HBTC-5JUN26-70000-P`, `BTC-USDC-WBTC-28AUG26-75000-C` each and every of this options is a separate token. 

Sui packages created per option series: `BTC-USDC-WBTC` one Move module, deployed Sui package, while `BTC-USDC-HBTC` is another Move module deployed as Sui package `BTC-USDC-SUI` yet another Move module and Sui package.

## Oracles

MUST use Pyth Sui oracle

### Supported assets / cash pairs in the protocol

- Bitcoin / USDC
  - Sui contracts (collateral address) `0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC` with `WBTC` ticker, for reference https://www.coingecko.com/en/coins/wrapped-bitcoin
  - Pyth oracle: `Crypto.BTC/USD` symbol and price feed id `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
  - settlement MUST use the deterministic Pyth expiry snapshot rules defined in `### Settlement oracle snapshot`
  - 1 option contract = 1 BTC, partial contracts for example 0.05, 0.1, 0.95 are allowed
  - min position size purchase is 0.05 BTC option contract, step 0.05 BTC means next min purchase will be 0.1 BTC, then 0.15 BTC, purchases must be multiplies of 0.05

### Settlement oracle snapshot

Settlement MUST use a single on-chain Pyth price snapshot at the exact option expiry time `T`, where `T` is Friday `08:00:00 UTC` for weekly expiries and last Friday of month `08:00:00 UTC` for monthly expiries.

The accepted Pyth price update MUST be selected deterministically:

- Primary snapshot: the first verified Pyth update for the configured feed id with `publish_time >= T` and `publish_time <= T + 5 minutes`.
- Fallback snapshot: if no primary snapshot exists, the latest verified Pyth update with `publish_time <= T` and `T - publish_time <= 5 minutes`.
- If neither snapshot exists, settlement MUST abort and enter manual settlement mode.

The protocol MUST use Pyth `price` and `conf` values from the accepted snapshot. The protocol MUST NOT use Pyth `emaPrice` for v1 settlement.

Settlement MUST fail and enter manual settlement mode if `conf / price > max_conf_ratio`, price is non-positive, feed id mismatches, Pyth exponent mismatches the configured option series exponent, exponent normalization overflows, quote/base feed is stale, market is unavailable, or no verified update exists in the allowed window.

Once a vault is settled with an accepted oracle snapshot, settlement result is final.

### Strike price

MUST use confidence bands, not only midpoint. Compute:

- `lower = price - conf`
- `upper = price + conf`
- For calls: exercise only if `lower > strike`; expire only if `upper <= strike`.
- For puts: exercise only if `upper < strike`; expire only if `lower >= strike`.
- If strike is inside `[lower, upper]`, treat as ATM/no-exercise.

The `max_conf_ratio` value MUST be configured per oracle feed before enabling an asset pair.

At current version treat USD and $USDC, USD and $USDT as always equal and pegged 1:1. In the future USD/quote "cash" token price will be included into settlement, now out of scope.

If Pyth price feed data is not available or cannot be used according to rules in this section then the protocol MUST abort settlement and mark it for manual settlement that will be handled by Operations team. Manual settlement MUST be limited to oracle failure cases and manual settlement transaction MUST include the settlement price, confidence, feed id.

## Premium

Always paid in "cash" token of option contract.

## Protocol Fees

The protocol fees `= infra fee + operational fee`, `infra fee = $0.05` in the "cash" token of the premium, `operational fee = $0.05 * total order premium` where `total order premium = premium per contract * number of contracts` in "cash" token of the premium

The protocol fee is deducted from maker fee before takers can see makers premium, takers see and receive premium `= maker quote total order premium - the protocol fees`.

Protocol fees MUST not be disclosure in taker UI.

## Contract Math

All on-chain option math MUST use unsigned integer amounts. Decimal human amounts MUST be converted to token base units before signing, storing, or submitting transactions.

For v1:
- `contractsQtyDecimals` uses collateral token decimals. For example WBTC with 8 decimals, `0.05 BTC = 5_000_000`.
- `strikePriceDecimals` uses the configured Pyth oracle exponent for the option series, independent of cash token decimals. If the configured Pyth exponent is `-8`, then `68000 USDC/BTC` means `strikePriceDecimals = 6_800_000_000_000`.
- `cashPremiumPerContract` uses cash token decimals per one whole contract. For example USDC with 6 decimals, `120 USDC = 120_000_000`.
- one whole contract equals `10^collateralTokenDecimals` units of collateral token.
- `oraclePriceScaleDecimals = -pythExponent` for negative Pyth exponents. Option series with non-negative Pyth exponents are not supported in v1.

Cash settlement cash amount MUST be:

```
settlementCash =
  floor(
    contractsQtyDecimals
    * strikePriceDecimals
    * 10^cashTokenDecimals
    / (10^collateralTokenDecimals * 10^oraclePriceScaleDecimals)
  )
```

Gross premium MUST be:

```
grossPremium =
  floor(
    contractsQtyDecimals
    * cashPremiumPerContract
    / 10^collateralTokenDecimals
  )
```

Example for `0.05 BTC` option contract, WBTC has 8 decimals, USDC has 6 decimals, Pyth exponent is `-8`, strike is `68000 USDC/BTC`, premium is `120 USDC` per 1 BTC contract:

```
contractsQtyDecimals = 5_000_000
strikePriceDecimals = 6_800_000_000_000
cashPremiumPerContract = 120_000_000

cashNotional = floor(5_000_000 * 6_800_000_000_000 * 1_000_000 / (100_000_000 * 100_000_000))
cashNotional = 3_400_000_000 // 3400 USDC

grossPremium = floor(5_000_000 * 120_000_000 / 100_000_000)
grossPremium = 6_000_000 // 6 USDC
```

Covered call underwriting:
- taker MUST deposit exactly `contractsQtyDecimals` collateral token units
- maker MUST pay `grossPremium` minus protocol fees to taker

Cash-secured put underwriting:
- taker MUST deposit exactly `cashNotional` cash token units
- maker MUST pay `grossPremium` minus protocol fees to taker

Covered call exercise:
- maker MUST deposit exactly `cashNotional` cash token units
- maker receives `contractsQtyDecimals` collateral token units from the vault
- takers receive cash pro-rata from the vault

Cash-secured put exercise:
- maker MUST deposit exactly `contractsQtyDecimals` collateral token units
- maker receives `cashNotional` cash token units from the vault
- takers receive collateral pro-rata from the vault

All division MUST round down with floor. Any required deposit or premium that rounds to zero MUST abort. Total individual payouts MUST NOT exceed vault balance. Remaining dust after all taker payouts goes to protocol treasury.

## Options life cycle

### Underwrite

Taker deposits to specific SFT vault with exact expiry, strike, put or call, collateral asset token for covered call contract and cash token for cash secured put contract. In exchange the taker receives makers premium.

The protocol mints corresponding SFT and transfers it to the maker. The protocol MUST validate signature of maker wallet that holds maker's cash. The protocol MUST validate that signed parameters from maker's order is not expired.

Vault for "cash secured put" MUST keep cash until exercise or expiration.

Vault for "covered call" MUST keep collateral until exercise or expiration.

Vault MUST keep internal ledger for taker for settlement in the future.

### Exercise and Expiration

Only in-the-money options can be exercised.

Makers MUST exercise all positions or nothing, partial exercise is not allowed.

The protocol MUST implement auto exercise Vaults after expiration + 1 hour. Any Vault that is not set by makers for exercise after 1 hour is expired worthless. In case if oracle price can't be determined at the expiry time then settlement process is handled manually by the protocol Operations team.

For maker to sets a "cash secured puts" vault to be exercise he must provide exact amount of collateral tokens needed to exercise all option tokens.

For maker to sets a "covered calls" vault to be exercises he must provide additional amount of cash tokens needed to exercise all option tokens.

Takers receive pro-rata from SFT vault. Takers must not take any actions to receive their share of collateral or cash from the vault. The protocol MUST use PTB to batch transfer funds to as many takers at once. The protocol MUST pay for gas of settlement transactions. Round every taker payout down with floor, never round up individual claims, because that can make the vault insolvent, send remaining amount after all taker payouts to protocol treasury, not to the last claimant, because “last claimant gets dust” creates claiming games. If a taker payout rounds to 0, it remains unclaimable and eventually goes to treasury.

On vault settlement through exercise or expiration, the protocol MUST delete vault storage, including the used-order hash set, to receive the Sui storage rebate.

## User stories

### Taker user stories

TODO: list user stories for taker

### Maker user stories

TODO: list user stories for maker

## Open questions

- do Market Makers prefer to buy "asset" from the market at an expiration date to long (buy) "cash secured put" option to settle them at the time of expiration or they prefer to deposit "asset" to be covered during the whole period of options they hold? Current assumption: deposit only cash to pay premium and later provide more cash for covered calls or assets for secured puts in case if maker what to exercise its option right
