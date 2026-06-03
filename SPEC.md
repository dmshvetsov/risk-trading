# Product Specification

Purpose: define specification of all parts of option trading on-chain protocol with off-chain application user interface and off-chain server infrastructure, where assets settlement logic implemented in the on-chain protocol and taker/maker logic in the off-chain users facing web application (aka client) and server infrastructure.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and `OPTIONAL` in this document are to be interpreted as described in RFC 2119.

## Product Language

This document uses `./DOMAIN-LANGUAGE.md` as way to describe option trading specific parts of the product used by business and technical members.

## What the protocol does

- facilitates trades between two parties, two types of users, takers "DeFi participants" and makers "Market Makers"
- takers willing to receive premium as immediate yield on stable coin "cash" for example $USDT or $USDC or supported by protocol assets for example $BTC or $SUI
  - by making "cash" deposit until next Friday 8:00 UTC or until last Friday 8:00 UTC of the month with obligation to exchange the deposit "cash" for chosen by taker "asset" if on-chain oracle price of the "asset" will fall below a beforehand specified price at the end of the period of this contract, known as "cash secured put" contract
  - by making "asset" deposit until next Friday 8:00 UTC or until last Friday 8:00 UTC of the month with obligation to exchange the deposit "asset" for chosen by taker "cash" token if on-chain oracle price of the "asset" will be above a beforehand specified price at the end of the period of this contract as "covered call" contract
- makers provide quote on how much a maker will pay premium for takers for "cash secured put" or "covered call" contract, quotes is the obligation to execute the quote to underwrite such contract between maker and taker
- makers willing
  - receive specified in the contract "cash" token for specified in the contract "assets" at beforehand agreed price at the end of the period of the contract, know as "cash secured put"
  - receive specified in the contract "asset" for specified in the contract "cash" token at beforehand agreed price at the end of the period of the contract, know as "covered call"
- underwrites (mint) and settles (burn expired or exercised) option fungible tokens that represents option contracts between taker and maker
  - for in-the-money "covered call" transfers "asset" to maker and "cash" `= strike price * "asset" quantity` to taker
  - for in-the-money "cash secured put" transfers "cash" to maker and "asset" quantity `= cash / strike price` to taker
  - for an-the-money "covered call" transfers "asset" back to taker
  - for an-the-money "cash secured put" transfers "cash" back to taker
  - for out-the-money "covered call" transfers "asset" back to taker
  - for out-the-money "cash secured put" transfers "cash" back to taker

Process in high-level flow for takers:
- taker visits the protocol web application
- taker picks contract type "covered call" or "cash secured put" and contract expiration date weekly or monthly
- taker use the protocol web application as for a quote from integrated to the protocol makers for given contract, asset, cash token and expiration date
- taker agrees to the best provided quote and sign a blockchain transaction and sends it to the protocol server
- protocol server broadcasts it to Sui Blockchain taker receives premium and maker receives option contact fungible token

Process in high-level flow for makers:
- maker integrates their API to the protocol server by implementing an endpoint(s) that returns quotes for takers
- maker deposits minimal cash $100000 in total to participate in the protocol, makers can deposit more but must hold the minimal amount to participate in the protocol
- the protocol uses deposited "cash" tokens to underwrite option contracts on behalf of maker and take small fee from the premium to the protocol treasury
- maker can withdraw deposited "cash" tokens at any time if tokens are not locked in "covered call" options
- maker can withdraw deposited "asset" at any time if tokens are not locked in "cash secured put" options

## Technical Stack

- Sui blockchain, and Move Language for smart contracts
- Cloudflare (workers, durable object, cache API, cron, queues) written in Rust language
- Cloudflare D1 database

## Option Ticker schema

`<oracle base token 3-5 chars>-<oracle quote token aka "cash" token 4 chars>-<collateral token aka "asset" token 3-5 chars>-<DDMMMYY format expiration date>-<call/put indicator C or P char><strike price>`

Examples:
- `BTC-USDT-WBTC-5JUN26-75000-C` options uses $BTC price, $USDT quote and "cash" for premium and deposit, $WBTC as collateral in Call option with expiration date 5 June 2026 and strike price 75000 in $USDT
- `BTC-USDT-WBTC-28AUG26-68000-P` options uses $BTC price, $USDT quote and "cash" for premium and deposit, $WBTC as collateral in Call option with expiration date 28 August 2026 and with strike price 68000 in $USDT
- `BTC-USDC-HBTC-5JUN26-68000-P` options uses $BTC price, $USDC quote and "cash" for premium and deposit, $HBTC (hashi BTC) as collateral in Put option with expiration date 5 June 2026 and with a strike price 68000 in $USDC
- `BTC-USDC-TBTC-5JUN26-1002000-C`
- `SUI-USDC-SUI-5JUN26-0.97-C` options uses $SUI price, $USDC quote for base $SUI and "cash" for premium and deposit, $SUI as collateral
- `SUI-USDC-HASUI-5JUN26-0.72P`
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

### 2. Server (Off-chain infrastructure)

#### 2.1 CRUD Server

Responsible to handle create, read, update, delete actions on the server database that required to facilitate main activity of the protocol explained in `## What the protocol does`

Implemented using Cloudflare Workers infrastructure and written in Rust programming language and `worker-rs` crate.

MUST implement API for:
- request for quote
- user dashboard of sold option contracts open, expired, exercised

MUST use Cloudflare Durable Object as a way to store provided quotes and their expiration.

#### 2.2 Broadcast Server

Responsible to broadcast off-chain agreed contract between taker and maker to Sui blockchain.

MUST implement API for:
- request for required parameters to build a Sui PTB to underwrite an option contract for a give quote
- settlement API that can be triggered by Cloduflare Scheduled job (Cron) or manually by an administrator of Operations team

MAY implement API for:
- submitting transaction on-chain

### 2.3 Web App (Off-chain decentralized application)

User interface for takers and makers.

MUST be mobile fist application.

MUST implement following pages:
- TODO copy all users pages from rysk.finance, docs.rysk.finance can be used to find what pages web application has

## How Integration with Market Makers works

Makers MUST white list 1+ wallets that will be used to sign quotes act as receivers of option tokens.

Makers MUST sign provided quotes with the wallet that will be receiver of option tokens.

Quote MUST include makers wallet that will be receiver of option tokens, this wallet must be signer of a quote signature.

Quote signature MUST be submitted on-chain and be logged inside underwrite event.

## Underwriting

Available for weekly options from Friday 08:00 (inclusive) till Friday 00:00 (exclusive). The protocol MUST stop underwriting contracts that will have less than 8 hours till expiration, on Friday 00:00

Token created per option `BTC-USDC-WBTC-5JUN26-75000-C` is one token, `BTC-USDC-WBTC-5JUN26-78000-C` is another token, `BTC-USDC-WBTC-5JUN26-70000-P`, `BTC-USDC-HBTC-5JUN26-70000-P`, `BTC-USDC-WBTC-28AUG26-75000-C` each and every of this options is a separate fungible token.

## Oracles

MUST use Pyth Sui oracle

### Supported assets in the protocol

- Bitcoin 
  - Sui contracts (collateral address) `0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC` with `WBTC` ticker, for reference https://www.coingecko.com/en/coins/wrapped-bitcoin
  - Pyth oracle: `Crypto.BTC/USD` symbol and price feed id `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
  - decimals are ignored in spot price
  - used Exponential Moving Average `emaPrice` [Pyth docs](https://docs.pyth.network/price-feeds/core/how-pyth-works/ema-price-aggregation) of last 24 hours from Thursday 08:00 to Friday 08:00
  - 1 option contract = 1 BTC
  - min purchase is 0.05 BTC option contract, step 0.05 BTC means next min purchase will be 0.1 BTC, then 0.15 BTC, purchases must be multiplies of 0.05

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

## User stories

### Taker user stories

TODO: list user stories for taker

### Maker user stories

TODO: list user stories for maker

## Open questions

- do Market Makers prefer to buy "asset" from the market at an expiration date to long (buy) "cash secured put" option to settle them at the time of expiration or they prefer to deposit "asset" to be covered during the whole period of options they hold? Current assumption: deposit asset to be covered
