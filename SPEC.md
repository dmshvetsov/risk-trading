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
- the protocol underwrites (mint) and settles (burn expired or exercised) option fungible tokens that represents option contracts between taker and maker
  - for in-the-money "covered call" transfers "asset" to maker and "cash" `= strike price * "asset" quantity` to taker
  - for in-the-money "cash secured put" transfers "cash" to maker and "asset" quantity `= cash / strike price` to taker
  - for an-the-money "covered call" transfers "asset" back to taker
  - for an-the-money "cash secured put" transfers "cash" back to taker
  - for out-the-money "covered call" transfers "asset" back to taker
  - for out-the-money "cash secured put" transfers "cash" back to taker

Process in high-level flow for takers:
- taker visits the protocol web application (UI)
- taker picks contract type "covered call" or "cash secured put" and contract expiration date weekly or monthly
- taker use the protocol web application to receive best quote from integrated to the protocol makers for given contract type call/put, asset collateral, cash token and expiration date
- taker agrees to underwrite a option token with the best provided quote and sign a blockchain transaction and sends it to the protocol server
- protocol server broadcasts it to Sui Blockchain taker receives premium and maker receives option contact fungible token

Process in high-level flow for makers:
- maker integrates their API to the protocol server by implementing an endpoint(s) that returns quotes for takers
- maker deposits minimal cash $100000 in total to participate in the protocol, makers can deposit more but must hold the minimal amount to participate in the protocol and receive RFQs
- the protocol deduct deposited "cash" tokens to underwrite option contracts on behalf of taker, pay premium to taker on behalf of maker and take the protocol fee from the premium to the protocol treasury
- at any point of time maker can withdraw current deposited "cash" tokens that exceeds the minimal market maker cash required to participate in the protocol activity

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

Semi-fungible token design with one smart contract per base/quote pair, for example `BTC-USDT-WBTC`, `BTC-USDC-WBTC`, `BTC-USDC-HBTC`, `SUI-USDC` are all separate smart contracts. Each contract has different tokens for option series. One token series shares the same expiration, strike, type call/put from SFT token and base/quote from contract.

### Ticker schema

`<oracle base token 3-5 chars>-<oracle quote token aka "cash" token 4 chars>-<collateral token aka "asset" token 3-5 chars>-<DDMMMYY format expiration date>-<strike price either flaoting point number 0. or whole 150 but not both>-<call/put marker C or P char>`

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
  - `::underwrite` creates a generic options fungible token
  - `::settle` expires or exercise generic put/call option fungible token
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
- `Treasury` for holding collected fees from facilitating option contracts trading

RECOMMENDED to use `sui::versioned::create` for versioning Sui long term objects that lived without known in advance expiration/burn/deletion date. For options tokens RECOMMENDED to not use `sui::versioned::create` as they are short lived and will be burned (expired) at explicitly know date.

MUST implement escrow shared object for maker to deposit "cash" tokens that will be used to pay premium for issued by maker quotes and agreed by taker

MUST issue following events:
- `EuropeanOption::Underwrite` includes maker's quote signature, option token address, option receiver address, underwriter address, premium paid to taker, put/call, oracle asset base and oracle quote token for the asset, collateral asset (might be different, for example BTC and wBTC or hashi BTC etc), expiration, strike price
- `EuropeanOption::Settle` includes maker's quote signature, option token address,
- `Maker::Deposit` includes amount and depositor
- `Maker::Withdrawal` includes amount and withdrawer
- `Treasury::Deposit` includes amount and depositor
- `Treasury::Withdrawal` includes amount and withdrawer

Smart contracts MUST verify maker quote signature, quote expiration and maker available cash during underwrite.

If maker available cash is insufficient at execution time then underwrite MUST abort atomically without locking taker collateral or minting option tokens.

### 2. Server (Off-chain infrastructure)

#### 2.1 CRUD Server

Responsible to handle create, read, update, delete actions on the server database that required to facilitate main activity of the protocol explained in `## What the protocol does`

Implemented using Cloudflare Workers infrastructure and written in Rust programming language and `worker-rs` crate.

MUST implement API for:
- request for quote
- user dashboard of sold option contracts open, expired, exercised

MUST use Cloudflare Durable Object as a way to store provided quotes and their expiration.

```
type QuoteRequest = {
  assetTokenAddress: string
  chainId: 'sui:mainnet' | 'sui:testnet'
  callPutMarker: 1 | 2 // 1: call 2: put
  longShortMarker: 1 | 2 // 1: long (buy option) 2: short (sell option)
  strikePrice: string // e8
	expiryUnixTs: number
  contractsQuantity: string // e18
  premiumTokenAddress: string
  collateralAssetAddress: string
}
```

```
type QuoteRespose = {
  quote: {
    assetTokenAddress: string // must match quote request
    chainId: 'sui:mainnet' | 'sui:testnet' // must match quote request
    callPutMarker: 1 | 2 // 1: call 2: put, must match quote request
    longShortMarker: 1 | 2 // 1: long (buy option) 2: short (sell option), must match quote request
    strikePrice: string // e8, must match quote request
    expiryUnixTs: number
    accountWalletAddress: string // wallet that manages deposited cash in the protocol, used to identify from what deposited cash to pay premium
    optionTokenReceiverAddress: string // can be different from accountWalletAddress, this wallet will receive option token(s)
    makerId: string // uniq maker id created in the protocol database
    premiumPerContract: string // premium per 1 option contract in premium token decimals
    offerValidUntilUnixTs: number
    usd:             string
    collateralAsset: string
  }
	signature: string // accountWalletAddress signature of the whole quote object
}
```

#### 2.2 Broadcast Server

Responsible to broadcast off-chain agreed contract between taker and maker to Sui blockchain.

MUST implement API for:
- request for required parameters to build a Sui PTB to underwrite an option contract for a give quote
- request for makers to exercise their option tokens with assignment of takers to exercise
- settlement API that can be triggered by Cloduflare Scheduled job (Cron) or manually by an administrator of Operations team

MAY implement API for:
- submitting transaction on-chain

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

## How Integration with Market Makers works

Makers MUST deposit cash to the protocol account for makers created using a EOA, this EOA will be used to sign quotes and pay premiums.

Makers MUST sign provided quotes with the wallet that will be receiver of option tokens.

Quote MUST include makers wallet that will be receiver of option tokens, this wallet must be signer of a quote signature.

Quote signature MUST be submitted on-chain and be logged inside underwrite event.

Maker quotes MUST be treated as short-lived reusable executable offers, not as one-time RFQ acceptances.

The same signed quote MAY be used by multiple takers while `offerValidUntilUnixTs` has not passed and the maker protocol account has enough available cash to pay premium and protocol fees.

## Creating (minting) option tokens (contracts)

Available for weekly options from Friday 08:00 (inclusive) till Friday 00:00 (exclusive). The protocol MUST stop underwriting contracts that will have less than 8 hours till expiration, on Friday 00:00

Token created per option `BTC-USDC-WBTC-5JUN26-75000-C` is one token, `BTC-USDC-WBTC-5JUN26-78000-C` is another token, `BTC-USDC-WBTC-5JUN26-70000-P`, `BTC-USDC-HBTC-5JUN26-70000-P`, `BTC-USDC-WBTC-28AUG26-75000-C` each and every of this options is a separate fungible token.

## Oracles

MUST use Pyth Sui oracle

### Supported assets / cash pairs in the protocol

- Bitcoin / USDC
  - Sui contracts (collateral address) `0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC` with `WBTC` ticker, for reference https://www.coingecko.com/en/coins/wrapped-bitcoin
  - Pyth oracle: `Crypto.BTC/USD` symbol and price feed id `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
  - used Exponential Moving Average `emaPrice` [Pyth docs](https://docs.pyth.network/price-feeds/core/how-pyth-works/ema-price-aggregation) of last 24 hours from Thursday 08:00 to Friday 08:00
  - 1 option contract = 1 BTC, partial contracts for example 0.05, 0.1, 0.95 are allowed
  - min position size purchase is 0.05 BTC option contract, step 0.05 BTC means next min purchase will be 0.1 BTC, then 0.15 BTC, purchases must be multiplies of 0.05

### Strike price

MUST use confidence bands, not only midpoint. Compute:

- `lower = price - conf`
- `upper = price + conf`
- For calls: exercise only if `lower > strike`; expire only if `upper <= strike`.
- For puts: exercise only if `upper < strike`; expire only if `lower >= strike`.
- If strike is inside `[lower, upper]`, treat as ATM/no-exercise or explicitly delay until confidence narrows. Given this product pays premium upfront, “ATM/no-exercise” is cleaner unless premium refund escrow is added.

Settlement MUST fail or enter delayed mode if `conf / price > max_conf_ratio`, price is non-positive, feed id mismatches, exponent normalization overflows, quote/base feed is stale, market is unavailable, or no verified update exists in the allowed window.

At current version treat USD and $USDC, USD and $USDT as always equal and pegged 1:1. In the future USD/quote "cash" token price will be included into settlement, now out of scope.

If Pyth price feed data is not available or cannot be used according to rules in this section then the protocol MUST abort settlement and mark it for manual settlement that will be handled by Operations team.

### Premium

Always paid in "cash" token of option contract

## Protocol Fees

The protocol fees `= infra fee + operational fee`, `infra fee = $0.05` in the "cash" token of the premium, `operational fee = $0.05 * total premium` where `total premium = premium per contract * number of contracts` in "cash" token of the premium

The protocol fee is deducted from maker fee and takers see premium they will receive `= maker quote premium - the protocol fees`.

Protocol fees MUST not be disclosure in taker UI.

## Options exercise

Only in-the-money options can be exercised. Market MUST makers exercise options tokens on their dashboard manually.

The protocol MUST NOT implement auto exercise on behalf of the options token holders.

When maker exercises his option tokens the protocol MUST assign taker that took obligation to "covered call" or "cash secured put" contract(s) to exercise a maker orders with random assignment of takers off-chain. Unassigned takers keep their collateral. If makers do not exercise their options withing 4 hours from token expiration date then those option tokens considered expired worthless. Protocol MUST settle worthless expired tokens by transferring collateral back to takers.

When maker exercises "cash secured puts" he must provide exact amount of collateral tokens needed to exercise all option tokens.

When maker exercises "covered calls" he must provide additional amount of cash tokens needed to exercise all option tokens.

The protocol MUST accept any amount of option tokens to exercise that a market maker have in his wallet.

## User stories

### Taker user stories

TODO: list user stories for taker

### Maker user stories

TODO: list user stories for maker

## Open questions

- do Market Makers prefer to buy "asset" from the market at an expiration date to long (buy) "cash secured put" option to settle them at the time of expiration or they prefer to deposit "asset" to be covered during the whole period of options they hold? Current assumption: deposit only cash to pay premium and later provide more cash for covered calls or assets for secured puts in case if maker what to exercise its option right
