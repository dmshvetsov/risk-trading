# Product Specification

Purpose: define specification of all parts of option trading on-chain protocol with off-chain application user interface and off-chain server infrastructure, where assets settlement logic implemented in the on-chain protocol and taker/maker logic in the off-chain users facing web application (aka client) and server infrastructure.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and `OPTIONAL` in this document are to be interpreted as described in RFC 2119.

## Product Language

This document uses `./DOMAIN-LANGUAGE.md` as way to describe option trading specific parts of the product used by business and technical members.

## What the protocol does

- the protocol facilitates trades between two parties, takers "DeFi participants" and makers "Market Makers"
- on-chain option roles, collateral movement, token ownership, exercise, and settlement are specified in `spec/OPTIONS_SMART_CONTRACT.md`

Process in high-level flow for takers:
- taker visits the protocol web application (UI)
- taker picks contract type "covered call" or "cash secured put" and contract expiration date weekly or monthly
- taker use the protocol web application to receive best quote from integrated to the protocol makers for given contract type call/put, asset collateral, cash token and expiration date
- taker agrees to a quote and signs a blockchain transaction sent through the protocol server
- protocol server broadcasts it to Sui Blockchain

Process in high-level flow for makers:
- maker integrates their API to the protocol server by implementing an endpoint(s) that returns quotes for takers
- maker meets protocol eligibility requirements to participate in RFQ flow
- maker provides signed quotes and orders that are executed on-chain according to `spec/OPTIONS_SMART_CONTRACT.md`

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

The on-chain token model is specified in `spec/OPTIONS_SMART_CONTRACT.md`.

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

The smart contract design, object model, underwriting, exercise, settlement, and event requirements are specified in `spec/OPTIONS_SMART_CONTRACT.md`.

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

Makers MUST use a wallet associated with their protocol account to sign quotes and orders.

Makers MUST sign quotes with the wallet used to create `Maker` account.

Makers MUST sign order with takers size and taker address. Order signature MUST be submitted on-chain and logged in underwrite event.

Maker `QuoteV1` signed messages MUST be treated as reusable, short-lived off-chain offers to buy options and MUST NOT authorize premium payment and/or token purchase. A maker MUST authorize `Long` buy and authorizes payment of the specified premium only by signing `OrderV1`.

The same signed quote MAY be used by multiple takers while `offerValidUntilUnixTs` has not passed or `offerValidUntilTotalContractsQty` is not exceeded and on-chain underwriting requirements can be satisfied. When RFQ server sends a transaction to Broadcaster it MUST deduct order quantity from current quote `offerValidUntilTotalContractsQty`, RFQ MUST not track if transaction was actually broadcasted on-chain thus the server does not guarantees to maker that his quote will be filled right up to `offerValidUntilTotalContractsQty`. RFQ server MUST NOT send more contracts quantity than `offerValidUntilTotalContractsQty` of current quote.

### Signed quote and order messages

JSON in this API is transport format only. Makers MUST NOT sign JSON bytes directly.

Quotes and orders MUST be signed as versioned BCS structs: `QuoteV1` and `OrderV1`. Field order MUST be exactly the order shown in `MakerQuoteV1` and `MakerOrderV1`. String amounts MUST be parsed as base-unit unsigned integers before BCS serialization. Addresses MUST use canonical Sui address bytes. Missing, null, extra, floating-point, or wrongly scaled fields MUST be rejected.

Each signed struct MUST include a `domain` field. Quote domain MUST be `otp:makerquote:v1`. Order domain MUST be `otp:makerorder:v1`.

Signature scheme for v1 MUST be Sui personal-message signing over the BCS bytes with Ed25519 keys. RFQ server MUST verify `MakerQuoteV1` and `MakerOrderV1` signatures. Smart contracts MUST verify `MakerOrderV1` domain, BCS bytes, signer address, and signature before underwriting.

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
    protocolPackageId: string // protocol package id
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
  signer: string // EOA wallet that manages maker protocol account
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
  chainId: 'sui:mainnet' | 'sui:testnet' // must match quote request
  takerAddress: string // must match ExecutionRequest.takerAddress
  collateralTokenAddress: string // must match quote request and derived vault
  collateralTokenDecimals: number
  cashTokenAddress: string // must match quote request, also will be used to pay premium
  cashTokenDecimals: number
  callPutMarker: 1 | 2 // u8 1: call 2: put, must match quote request
  sideMarker: 1 | 2 // u8 1: long (buy option) 2: short (sell option), must match quote request
  strikePriceDecimals: string // uses configured Pyth oracle exponent, must match quote request and derived vault
  expiryUnixTs: number
  contractsQtyDecimals: string // uses collateralTokenDecimals
  cashPremiumPerContract: string // premium per 1 option contract in premium token decimals
  goodTillUnixTs: number
  makerVaultId: string // uniq maker vault id created in the protocol
  quoteId: string // must match ExecutionRequest.quote.quoteId
  signer: string // EOA wallet address that manages maker protocol account
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
- settlement API that can be triggered by Cloduflare Scheduled job (Cron) or manually by an administrator of the protocol Operations team
- submitting transaction on-chain

MUST implement Cloudflare queues for transaction submission where sequential processing is required by shared on-chain object access.

Broadcast server runs one in-flight transaction per configured queue partition and waits for finality before next transaction.

### 2.3 Web App (Off-chain decentralized application)

User interface for takers and makers.

MUST be mobile fist application.

MUST implement following pages:
- Home page with supported assets and call to action to open an option contract.
- Option quote builder page for a selected asset and contract type, including strike selection, expiry selection, position size input, collateral requirements, quoted premium, oracle spot price, expected expiry outcome of the contracts if price stay above equal or below strike. Must request another quote if current expires. Must have a CTA that triggers an on-chain transaction.
- Taker dashboard page showing open positions with indication what will happen if expiration and settlement will be now, settled positions, expired positions, pending settlement, with data for position: spot/current oracle price (if open position) otherwise price at expiration, strike, premium
- Maker dashboard page showing open positions, ITM/OTM status, required settlement funds, settlement readiness, and settlement history

Taker UI MUST use simple language. MUST NOT mention of options or derivatives.

Maker UI MUST use professional option trader language.

MUST use Broadcast server to submit transaction on-chain.

MUST use Pyth Hermess client to fetch prices for assets.

## Oracles

MUST use Pyth Sui API oracle to submit prices at time of expiration on-chain.

### Supported assets / cash pairs in the protocol

- Bitcoin / USDC
  - Sui contracts (collateral address) `0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC` with `WBTC` ticker, for reference https://www.coingecko.com/en/coins/wrapped-bitcoin
  - Pyth oracle: `Crypto.BTC/USD` symbol and price feed id `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
  - 1 option contract = 1 BTC, partial contracts for example 0.05, 0.1, 0.95 are allowed
  - min position size purchase is 0.05 BTC option contract, step 0.05 BTC means next min purchase will be 0.1 BTC, then 0.15 BTC, purchases must be multiplies of 0.05

## Premium

Always paid in "cash" token of option contract.

## Protocol Fees

Protocol fees MUST not be disclosure in seller/taker UI.
