module options_trading_protocol::underwriting;

use options_trading_protocol::series::{Self, CollateralPool, Series};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;

const EInvalidSeriesType: u64 = 0;
const EInsufficientCollateral: u64 = 1;
const EFeeExceedsPremium: u64 = 2;
const EFeeExceedsMaximum: u64 = 3;
const ELongMismatch: u64 = 4;
const EInsufficientQuantity: u64 = 5;

public struct Long<phantom QuoteCoin, phantom BaseCoin> has key, store {
    id: UID,
    market_id: ID,
    series_id: ID,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    quantity: u64,
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
}

public fun underwrite_call<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    pool: &mut CollateralPool<QuoteCoin, BaseCoin>,
    collateral: Coin<BaseCoin>,
    premium: Coin<QuoteCoin>,
    quantity: u64,
    operational_fee: u64,
    max_operational_fee: Option<u64>,
    buyer: address,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
): (Long<QuoteCoin, BaseCoin>, Coin<QuoteCoin>, Coin<QuoteCoin>) {
    assert!(series::option_type(series) == series::option_type_call(), EInvalidSeriesType);
    assert!(collateral.value() == quantity, EInsufficientCollateral);
    series::assert_open_for_underwriting(series, clock);

    let (seller_premium, fee) = split_premium(premium, operational_fee, max_operational_fee, ctx);
    series::record_call_underwriting(
        series,
        pool,
        ctx.sender(),
        quantity,
        collateral.into_balance(),
    );
    let long = mint_long(series, quantity, ctx);
    emit_underwritten(
        series,
        ctx.sender(),
        buyer,
        fee_recipient,
        quantity,
        quantity,
        seller_premium.value() + fee.value(),
        operational_fee,
    );
    (long, seller_premium, fee)
}

#[allow(lint(self_transfer))]
public fun underwrite_call_and_transfer<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    pool: &mut CollateralPool<QuoteCoin, BaseCoin>,
    collateral: Coin<BaseCoin>,
    premium: Coin<QuoteCoin>,
    quantity: u64,
    operational_fee: u64,
    max_operational_fee: Option<u64>,
    buyer: address,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let seller = ctx.sender();
    let (long, seller_premium, fee) = underwrite_call(
        series,
        pool,
        collateral,
        premium,
        quantity,
        operational_fee,
        max_operational_fee,
        buyer,
        fee_recipient,
        clock,
        ctx,
    );
    transfer::public_transfer(long, buyer);
    transfer::public_transfer(seller_premium, seller);
    transfer::public_transfer(fee, fee_recipient);
}

public fun underwrite_put<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    pool: &mut CollateralPool<QuoteCoin, BaseCoin>,
    collateral: Coin<QuoteCoin>,
    premium: Coin<QuoteCoin>,
    quantity: u64,
    operational_fee: u64,
    max_operational_fee: Option<u64>,
    buyer: address,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
): (Long<QuoteCoin, BaseCoin>, Coin<QuoteCoin>, Coin<QuoteCoin>) {
    assert!(series::option_type(series) == series::option_type_put(), EInvalidSeriesType);
    let collateral_required = strike_payment(series, quantity);
    assert!(collateral.value() == collateral_required, EInsufficientCollateral);
    series::assert_open_for_underwriting(series, clock);

    let (seller_premium, fee) = split_premium(premium, operational_fee, max_operational_fee, ctx);
    series::record_put_underwriting(
        series,
        pool,
        ctx.sender(),
        quantity,
        collateral_required,
        collateral.into_balance(),
    );
    let long = mint_long(series, quantity, ctx);
    emit_underwritten(
        series,
        ctx.sender(),
        buyer,
        fee_recipient,
        quantity,
        collateral_required,
        seller_premium.value() + fee.value(),
        operational_fee,
    );
    (long, seller_premium, fee)
}

#[allow(lint(self_transfer))]
public fun underwrite_put_and_transfer<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    pool: &mut CollateralPool<QuoteCoin, BaseCoin>,
    collateral: Coin<QuoteCoin>,
    premium: Coin<QuoteCoin>,
    quantity: u64,
    operational_fee: u64,
    max_operational_fee: Option<u64>,
    buyer: address,
    fee_recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let seller = ctx.sender();
    let (long, seller_premium, fee) = underwrite_put(
        series,
        pool,
        collateral,
        premium,
        quantity,
        operational_fee,
        max_operational_fee,
        buyer,
        fee_recipient,
        clock,
        ctx,
    );
    transfer::public_transfer(long, buyer);
    transfer::public_transfer(seller_premium, seller);
    transfer::public_transfer(fee, fee_recipient);
}

public fun split<QuoteCoin, BaseCoin>(
    long: &mut Long<QuoteCoin, BaseCoin>,
    quantity: u64,
    ctx: &mut TxContext,
): Long<QuoteCoin, BaseCoin> {
    assert!(quantity <= long.quantity, EInsufficientQuantity);
    long.quantity = long.quantity - quantity;
    Long {
        id: object::new(ctx),
        market_id: long.market_id,
        series_id: long.series_id,
        option_type: long.option_type,
        strike_price: long.strike_price,
        expiry_ms: long.expiry_ms,
        quantity,
    }
}

public fun join<QuoteCoin, BaseCoin>(
    target: &mut Long<QuoteCoin, BaseCoin>,
    source: Long<QuoteCoin, BaseCoin>,
) {
    let Long { id, market_id, series_id, option_type, strike_price, expiry_ms, quantity } = source;
    assert!(target.market_id == market_id, ELongMismatch);
    assert!(target.series_id == series_id, ELongMismatch);
    assert!(target.option_type == option_type, ELongMismatch);
    assert!(target.strike_price == strike_price, ELongMismatch);
    assert!(target.expiry_ms == expiry_ms, ELongMismatch);
    id.delete();
    target.quantity = target.quantity + quantity;
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

public fun long_market_id<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): ID {
    long.market_id
}

public fun long_series_id<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): ID {
    long.series_id
}

public fun long_option_type<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u8 {
    long.option_type
}

public fun long_strike_price<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u64 {
    long.strike_price
}

public fun long_expiry_ms<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u64 {
    long.expiry_ms
}

public fun long_quantity<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u64 {
    long.quantity
}

fun mint_long<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    quantity: u64,
    ctx: &mut TxContext,
): Long<QuoteCoin, BaseCoin> {
    Long {
        id: object::new(ctx),
        market_id: series::market_id(series),
        series_id: object::id(series),
        option_type: series::option_type(series),
        strike_price: series::strike_price(series),
        expiry_ms: series::expiry_ms(series),
        quantity,
    }
}

fun split_premium<QuoteCoin>(
    mut premium: Coin<QuoteCoin>,
    operational_fee: u64,
    max_operational_fee: Option<u64>,
    ctx: &mut TxContext,
): (Coin<QuoteCoin>, Coin<QuoteCoin>) {
    let premium_total = premium.value();
    assert!(operational_fee <= premium_total, EFeeExceedsPremium);
    max_operational_fee.do!(|max_fee| {
        assert!(operational_fee <= max_fee, EFeeExceedsMaximum);
    });
    let fee = premium.split(operational_fee, ctx);
    (premium, fee)
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
    });
}

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
