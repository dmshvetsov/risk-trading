module options_trading_protocol::underwriting;

use options_trading_protocol::buyer_vault::{Self, BuyerVault};
use options_trading_protocol::long::{Self, Long};
use options_trading_protocol::market::{Self, Market};
use options_trading_protocol::series::{Self, Series};
use std::bcs;
use sui::address;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::ed25519;
use sui::event;
use sui::hash;

const EInvalidSeriesType: u64 = 0;
const EInsufficientCollateral: u64 = 1;
const EFeeExceedsPremium: u64 = 2;
const EFeeExceedsMaximum: u64 = 3;
const EMarketMismatch: u64 = 4;
const EInvalidOrderEncoding: u64 = 5;
const EInvalidOrder: u64 = 6;
const EInvalidSignature: u64 = 7;
const EOrderExpired: u64 = 8;
const EPremiumOverflow: u64 = 9;

const ORDER_DOMAIN: vector<u8> = b"otp:order:v1";
const SIDE_LONG: u8 = 1;
const ED25519_FLAG: u8 = 0;
const SERIALIZED_SIGNATURE_LENGTH: u64 = 97;
const ED25519_SIGNATURE_LENGTH: u64 = 64;

const BPS_DENOMINATOR: u64 = 10_000;

public struct OrderV1 has copy, drop {
    domain: vector<u8>,
    seller: address,
    market_id: address,
    call_put_marker: u8,
    side_marker: u8,
    strike_price: u64,
    expiry_ms: u64,
    contracts_quantity: u64,
    premium_per_contract: u64,
    good_till_ms: u64,
    buyer_vault_id: address,
    signer: address,
}

public struct SignedOrderV1 has drop {
    order: vector<u8>,
    signature: vector<u8>,
    public_key: vector<u8>,
}

public struct Underwritten has copy, drop {
    market_id: ID,
    series_id: ID,
    seller: address,
    buyer: address,
    fee_recipient: address,
    option_type: u8,
    quantity: u64,
    collateral_quantity: u64,
    premium_total: u64,
    operational_fee: u64,
    long_token_id: ID,
}

public fun underwrite_call<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &mut Series<QuoteCoin, BaseCoin>,
    buyer_vault: &mut BuyerVault<QuoteCoin>,
    collateral: Coin<BaseCoin>,
    signed_order_bytes: vector<u8>,
    operational_fee: u64,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let signed_order = decode_signed_order(signed_order_bytes);
    let SignedOrderV1 { order: order_bytes, signature, public_key } = signed_order;
    let order = decode_order(order_bytes);
    verify_signed_order(&order, &order_bytes, &signature, &public_key);
    validate_order(market, series, buyer_vault, &order, series::option_type_call(), clock, ctx);

    let premium_total = calculate_premium_total(&order, market);
    let premium = buyer_vault::debit(buyer_vault, premium_total, ctx);
    consume_order(series, &order_bytes);
    execute_call_underwriting(
        market,
        series,
        collateral,
        premium,
        order.contracts_quantity,
        operational_fee,
        order.signer,
        fee_recipient,
        clock,
        ctx,
    );
}

public fun underwrite_put<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &mut Series<QuoteCoin, BaseCoin>,
    buyer_vault: &mut BuyerVault<QuoteCoin>,
    collateral: Coin<QuoteCoin>,
    signed_order_bytes: vector<u8>,
    operational_fee: u64,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let signed_order = decode_signed_order(signed_order_bytes);
    let SignedOrderV1 { order: order_bytes, signature, public_key } = signed_order;
    let order = decode_order(order_bytes);
    verify_signed_order(&order, &order_bytes, &signature, &public_key);
    validate_order(market, series, buyer_vault, &order, series::option_type_put(), clock, ctx);

    let premium_total = calculate_premium_total(&order, market);
    let premium = buyer_vault::debit(buyer_vault, premium_total, ctx);
    consume_order(series, &order_bytes);
    execute_put_underwriting(
        market,
        series,
        collateral,
        premium,
        order.contracts_quantity,
        operational_fee,
        order.signer,
        fee_recipient,
        clock,
        ctx,
    );
}

public fun decode_order(order_bytes: vector<u8>): OrderV1 {
    let mut bytes = sui::bcs::new(order_bytes);
    let order = OrderV1 {
        domain: bytes.peel_vec_u8(),
        seller: bytes.peel_address(),
        market_id: bytes.peel_address(),
        call_put_marker: bytes.peel_u8(),
        side_marker: bytes.peel_u8(),
        strike_price: bytes.peel_u64(),
        expiry_ms: bytes.peel_u64(),
        contracts_quantity: bytes.peel_u64(),
        premium_per_contract: bytes.peel_u64(),
        good_till_ms: bytes.peel_u64(),
        buyer_vault_id: bytes.peel_address(),
        signer: bytes.peel_address(),
    };
    assert!(bytes.into_remainder_bytes().is_empty(), EInvalidOrderEncoding);
    assert!(bcs::to_bytes(&order) == order_bytes, EInvalidOrderEncoding);
    order
}

fun decode_signed_order(signed_order_bytes: vector<u8>): SignedOrderV1 {
    let mut bytes = sui::bcs::new(signed_order_bytes);
    let signed_order = SignedOrderV1 {
        order: bytes.peel_vec_u8(),
        signature: bytes.peel_vec_u8(),
        public_key: bytes.peel_vec_u8(),
    };
    assert!(bytes.into_remainder_bytes().is_empty(), EInvalidOrderEncoding);
    assert!(bcs::to_bytes(&signed_order) == signed_order_bytes, EInvalidOrderEncoding);
    signed_order
}

public fun verify_signed_order(
    order: &OrderV1,
    order_bytes: &vector<u8>,
    serialized_signature: &vector<u8>,
    public_key: &vector<u8>,
) {
    assert!(serialized_signature.length() == SERIALIZED_SIGNATURE_LENGTH, EInvalidSignature);
    let mut blob = *serialized_signature;
    assert!(blob.remove(0) == ED25519_FLAG, EInvalidSignature);
    let mut signature = vector[];
    ED25519_SIGNATURE_LENGTH.do!(|_| signature.push_back(blob.remove(0)));
    assert!(blob == *public_key, EInvalidSignature);

    let mut intent_message = vector[3, 0, 0];
    intent_message.append(bcs::to_bytes(order_bytes));
    let digest = hash::blake2b256(&intent_message);
    assert!(ed25519::ed25519_verify(&signature, public_key, &digest), EInvalidSignature);

    let mut address_bytes = vector[ED25519_FLAG];
    address_bytes.append(*public_key);
    assert!(address::from_bytes(hash::blake2b256(&address_bytes)) == order.signer, EInvalidSignature);
}

fun validate_order<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &Series<QuoteCoin, BaseCoin>,
    buyer_vault: &BuyerVault<QuoteCoin>,
    order: &OrderV1,
    expected_option_type: u8,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(order.domain == ORDER_DOMAIN, EInvalidOrder);
    assert!(order.seller == ctx.sender(), EInvalidOrder);
    assert!(order.market_id == market::id(market).to_address(), EInvalidOrder);
    assert!(series::market_id(series) == market::id(market), EInvalidOrder);
    assert!(order.call_put_marker == expected_option_type, EInvalidOrder);
    assert!(series::option_type(series) == expected_option_type, EInvalidOrder);
    assert!(order.side_marker == SIDE_LONG, EInvalidOrder);
    assert!(order.strike_price == series::strike_price(series), EInvalidOrder);
    assert!(order.expiry_ms == series::expiry_ms(series), EInvalidOrder);
    assert!(order.buyer_vault_id == object::id(buyer_vault).to_address(), EInvalidOrder);
    assert!(order.signer == buyer_vault::owner(buyer_vault), EInvalidOrder);
    assert!(clock.timestamp_ms() <= order.good_till_ms, EOrderExpired);
}

fun calculate_premium_total(order: &OrderV1, market: &Market): u64 {
    let contract_scale = pow10(market::base_decimals(market));
    let total =
        (order.premium_per_contract as u128)
        * (order.contracts_quantity as u128)
        / (contract_scale as u128);
    assert!(total <= 18_446_744_073_709_551_615, EPremiumOverflow);
    total as u64
}

fun consume_order<QuoteCoin, BaseCoin>(series: &mut Series<QuoteCoin, BaseCoin>, order_bytes: &vector<u8>) {
    series::consume_order(series, hash::blake2b256(order_bytes));
}

public fun order_domain(order: &OrderV1): vector<u8> { order.domain }
public fun order_seller(order: &OrderV1): address { order.seller }
public fun order_market_id(order: &OrderV1): address { order.market_id }
public fun order_call_put_marker(order: &OrderV1): u8 { order.call_put_marker }
public fun order_side_marker(order: &OrderV1): u8 { order.side_marker }
public fun order_strike_price(order: &OrderV1): u64 { order.strike_price }
public fun order_expiry_ms(order: &OrderV1): u64 { order.expiry_ms }
public fun order_contracts_quantity(order: &OrderV1): u64 { order.contracts_quantity }
public fun order_premium_per_contract(order: &OrderV1): u64 { order.premium_per_contract }
public fun order_good_till_ms(order: &OrderV1): u64 { order.good_till_ms }
public fun order_buyer_vault_id(order: &OrderV1): address { order.buyer_vault_id }
public fun order_signer(order: &OrderV1): address { order.signer }

#[allow(lint(self_transfer))]
public(package) fun execute_call_underwriting<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &mut Series<QuoteCoin, BaseCoin>,
    collateral: Coin<BaseCoin>,
    premium: Coin<QuoteCoin>,
    quantity: u64,
    operational_fee: u64,
    buyer: address,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_market_open(market, series);
    assert!(series::option_type(series) == series::option_type_call(), EInvalidSeriesType);
    assert!(collateral.value() == quantity, EInsufficientCollateral);
    series::assert_open_for_underwriting(series, clock);

    let seller = ctx.sender();
    let (seller_premium, fee) = split_premium(premium, operational_fee, series, ctx);
    series::record_call_underwriting(
        series,
        seller,
        quantity,
        collateral.into_balance(),
    );
    let long: Long<QuoteCoin, BaseCoin> = long::mint(
        series::market_id(series),
        object::id(series),
        series::option_type(series),
        series::strike_price(series),
        series::expiry_ms(series),
        quantity,
        ctx,
    );
    emit_underwritten(
        series,
        ctx.sender(),
        buyer,
        fee_recipient,
        quantity,
        quantity,
        seller_premium.value() + fee.value(),
        operational_fee,
        object::id(&long),
    );
    transfer::public_transfer(long, buyer);
    transfer::public_transfer(seller_premium, seller);
    transfer::public_transfer(fee, fee_recipient);
}

#[allow(lint(self_transfer))]
public(package) fun execute_put_underwriting<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &mut Series<QuoteCoin, BaseCoin>,
    collateral: Coin<QuoteCoin>,
    premium: Coin<QuoteCoin>,
    quantity: u64,
    operational_fee: u64,
    buyer: address,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_market_open(market, series);
    assert!(series::option_type(series) == series::option_type_put(), EInvalidSeriesType);
    let collateral_required = strike_payment(series, quantity);
    assert!(collateral.value() == collateral_required, EInsufficientCollateral);
    series::assert_open_for_underwriting(series, clock);

    let seller = ctx.sender();
    let (seller_premium, fee) = split_premium(premium, operational_fee, series, ctx);
    series::record_put_underwriting(
        series,
        seller,
        quantity,
        collateral_required,
        collateral.into_balance(),
    );
    let long: Long<QuoteCoin, BaseCoin> = long::mint(
        series::market_id(series),
        object::id(series),
        series::option_type(series),
        series::strike_price(series),
        series::expiry_ms(series),
        quantity,
        ctx,
    );
    emit_underwritten(
        series,
        ctx.sender(),
        buyer,
        fee_recipient,
        quantity,
        collateral_required,
        seller_premium.value() + fee.value(),
        operational_fee,
        object::id(&long),
    );
    transfer::public_transfer(long, buyer);
    transfer::public_transfer(seller_premium, seller);
    transfer::public_transfer(fee, fee_recipient);
}

fun assert_market_open<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &Series<QuoteCoin, BaseCoin>,
) {
    assert!(market::id(market) == series::market_id(series), EMarketMismatch);
    market::assert_not_paused(market);
}

public fun strike_payment<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    quantity: u64,
): u64 {
    let numerator =
        (quantity as u256)
        * (series::strike_price(series) as u256)
        * (quote_scale(series) as u256);
    let denominator = (base_scale(series) as u256) * (series::strike_scale(series) as u256);
    (((numerator + denominator - 1) / denominator) as u64)
}

fun split_premium<QuoteCoin, BaseCoin>(
    mut premium: Coin<QuoteCoin>,
    operational_fee: u64,
    series: &Series<QuoteCoin, BaseCoin>,
    ctx: &mut TxContext,
): (Coin<QuoteCoin>, Coin<QuoteCoin>) {
    let premium_total = premium.value();
    assert!(operational_fee <= premium_total, EFeeExceedsPremium);
    let max_fee = max_operational_fee(premium_total, series::max_operational_fee_bps(series));
    assert!(operational_fee <= max_fee, EFeeExceedsMaximum);
    let fee = premium.split(operational_fee, ctx);
    (premium, fee)
}

fun max_operational_fee(premium_total: u64, max_operational_fee_bps: u64): u64 {
    (((premium_total as u256) * (max_operational_fee_bps as u256) / (BPS_DENOMINATOR as u256)) as u64)
}

fun emit_underwritten<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    seller: address,
    buyer: address,
    fee_recipient: address,
    quantity: u64,
    collateral_quantity: u64,
    premium_total: u64,
    operational_fee: u64,
    long_token_id: ID,
) {
    event::emit(Underwritten {
        market_id: series::market_id(series),
        series_id: object::id(series),
        seller,
        buyer,
        fee_recipient,
        option_type: series::option_type(series),
        quantity,
        collateral_quantity,
        premium_total,
        operational_fee,
        long_token_id,
    });
}

public fun market_id(event: &Underwritten): ID { event.market_id }
public fun series_id(event: &Underwritten): ID { event.series_id }
public fun seller(event: &Underwritten): address { event.seller }
public fun buyer(event: &Underwritten): address { event.buyer }
public fun fee_recipient(event: &Underwritten): address { event.fee_recipient }
public fun quantity(event: &Underwritten): u64 { event.quantity }
public fun premium_total(event: &Underwritten): u64 { event.premium_total }
public fun operational_fee(event: &Underwritten): u64 { event.operational_fee }
public fun long_token_id(event: &Underwritten): ID { event.long_token_id }

fun quote_scale<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    pow10(series::quote_decimals(series))
}

fun base_scale<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    pow10(series::base_decimals(series))
}

fun pow10(decimals: u8): u64 {
    let mut result = 1;
    decimals.do!(|_| {
        result = result * 10;
    });
    result
}
