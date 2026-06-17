module options_trading_protocol::underwriting;

use options_trading_protocol::long::{Self, Long};
use options_trading_protocol::market::{Self, Market};
use options_trading_protocol::series::{Self, Series};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;

const EInvalidSeriesType: u64 = 0;
const EInsufficientCollateral: u64 = 1;
const EFeeExceedsPremium: u64 = 2;
const EFeeExceedsMaximum: u64 = 3;
const EMarketMismatch: u64 = 4;

const BPS_DENOMINATOR: u64 = 10_000;

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

#[allow(lint(self_transfer))]
public fun underwrite_call<QuoteCoin, BaseCoin>(
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
public fun underwrite_put<QuoteCoin, BaseCoin>(
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
