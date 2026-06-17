module options_trading_protocol::series;

use options_trading_protocol::market::{Self, Market};
use options_trading_protocol::long::{Self, Long};
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::dynamic_field;
use sui::event;

const OPTION_TYPE_CALL: u8 = 1;
const OPTION_TYPE_PUT: u8 = 2;

const STATE_OPEN: u8 = 0;
const STATE_EXPIRATION_PRICE_FINALIZED: u8 = 1;
const STATE_CLOSED: u8 = 2;

const PHASE_OPEN: u8 = 0;
const PHASE_PRICE_PENDING: u8 = 1;
const PHASE_NO_EXERCISE_EXPIRY: u8 = 2;
const PHASE_MANUAL_EXERCISE: u8 = 3;
const PHASE_EXERCISE_BY_EXCEPTION: u8 = 4;
const PHASE_PARTIAL_SETTLEMENT: u8 = 5;
const PHASE_FULL_SETTLEMENT: u8 = 6;

const EXERCISE_WINDOW_MS: u64 = 60 * 60 * 1000;
const EXCEPTION_WINDOW_MS: u64 = 60 * 60 * 1000;
const MIN_UNDERWRITING_TIME_TO_EXPIRY_MS: u64 = 8 * 60 * 60 * 1000;

const EInvalidOptionType: u64 = 0;
const EInvalidStrike: u64 = 1;
const EExpiredSeries: u64 = 2;
const EDuplicateSeries: u64 = 3;
const ESellerVaultMissing: u64 = 5;
const EInvalidExpiryPrice: u64 = 6;
const EStaleExpiryPrice: u64 = 7;
const EExpiryPriceMismatch: u64 = 8;
const EExpiryPriceAlreadyFinalized: u64 = 9;
const EExpiryNotReached: u64 = 10;
const EInvalidExercisePhase: u64 = 11;
const ELongMismatch: u64 = 12;
const EInvalidExerciseQuantity: u64 = 13;
const EInvalidExercisePayment: u64 = 14;
const EInsufficientCollateral: u64 = 15;
const EInvalidSettlementPhase: u64 = 16;
const ESellerVaultAlreadySettled: u64 = 17;

public struct SellerVaultKey(address) has copy, drop, store;

public struct SellerVault has store {
    seller: address,
    series_id: ID,
    short_quantity: u64,
    collateral_quantity: u64,
    settlement_state: u8,
}

public struct Series<phantom QuoteCoin, phantom BaseCoin> has key {
    id: UID,
    market_id: ID,
    option_type: u8,
    strike_price: u64,
    quote_decimals: u8,
    base_decimals: u8,
    strike_scale: u64,
    max_operational_fee_bps: u64,
    expiry_ms: u64,
    exercise_window_end_ms: u64,
    exception_window_end_ms: u64,
    total_short_quantity: u64,
    total_manual_exercised_quantity: u64,
    total_exercise_by_exception_quantity: u64,
    total_manual_exercise_base_proceeds: u64,
    total_manual_exercise_quote_proceeds: u64,
    expiry_price: Option<u64>,
    expiry_price_publish_time_ms: Option<u64>,
    collateral_pool: CollateralPool<QuoteCoin, BaseCoin>,
    seller_vault_index: vector<address>,
    state: u8,
}

public struct CollateralPool<phantom QuoteCoin, phantom BaseCoin> has key, store {
    id: UID,
    base_balance: Balance<BaseCoin>,
    quote_balance: Balance<QuoteCoin>,
    accounted_base_balance: u64,
    accounted_quote_balance: u64,
}

public struct SeriesCreated has copy, drop {
    series_id: ID,
    market_id: ID,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    exercise_window_end_ms: u64,
    exception_window_end_ms: u64,
}

public struct ExpiryPrice {
    market_id: ID,
    oracle: String,
    oracle_feed_id: vector<u8>,
    expiry_ms: u64,
    expiry_price: u64,
    publish_time_ms: u64,
    price_payload_hash: vector<u8>,
}

public struct ExpiryPriceFinalized has copy, drop {
    series_id: ID,
    oracle: String,
    oracle_feed_id: vector<u8>,
    expiry_price: u64,
    publish_time_ms: u64,
    price_payload_hash: vector<u8>,
}

public struct Exercised has copy, drop {
    series_id: ID,
    holder: address,
    option_type: u8,
    quantity: u64,
    input_asset_amount: u64,
    output_asset_amount: u64,
}

public struct SellerPayoutSettled has copy, drop {
    series_id: ID,
    seller: address,
    short_quantity: u64,
    base_paid: u64,
    quote_paid: u64,
}

public struct SeriesSettlementBatchCompleted has copy, drop {
    series_id: ID,
    settled_seller_count: u64,
    base_paid_total: u64,
    quote_paid_total: u64,
}

public fun create_series<QuoteCoin, BaseCoin>(
    market: &mut Market,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    market::assert_not_paused(market);
    market::assert_supported_coin_types<QuoteCoin, BaseCoin>(market);
    assert!(option_type == OPTION_TYPE_CALL || option_type == OPTION_TYPE_PUT, EInvalidOptionType);
    assert!(strike_price > 0, EInvalidStrike);
    let now_ms = clock.timestamp_ms();
    assert!(expiry_ms > now_ms, EExpiredSeries);
    assert!(expiry_ms - now_ms > MIN_UNDERWRITING_TIME_TO_EXPIRY_MS, EExpiredSeries);
    assert!(!market::has_series(market, option_type, strike_price, expiry_ms), EDuplicateSeries);

    let exercise_window_end_ms = expiry_ms + EXERCISE_WINDOW_MS;
    let exception_window_end_ms = exercise_window_end_ms + EXCEPTION_WINDOW_MS;
    let series_id = object::new(ctx);
    let series_object_id = object::uid_to_inner(&series_id);
    let market_id = market::id(market);

    let series = Series<QuoteCoin, BaseCoin> {
        id: series_id,
        market_id,
        option_type,
        strike_price,
        quote_decimals: market::quote_decimals(market),
        base_decimals: market::base_decimals(market),
        strike_scale: market::strike_scale(market),
        max_operational_fee_bps: market::max_operational_fee_bps(market),
        expiry_ms,
        exercise_window_end_ms,
        exception_window_end_ms,
        total_short_quantity: 0,
        total_manual_exercised_quantity: 0,
        total_exercise_by_exception_quantity: 0,
        total_manual_exercise_base_proceeds: 0,
        total_manual_exercise_quote_proceeds: 0,
        expiry_price: option::none(),
        expiry_price_publish_time_ms: option::none(),
        collateral_pool: CollateralPool<QuoteCoin, BaseCoin> {
            id: object::new(ctx),
            base_balance: balance::zero(),
            quote_balance: balance::zero(),
            accounted_base_balance: 0,
            accounted_quote_balance: 0,
        },
        seller_vault_index: vector[],
        state: STATE_OPEN,
    };

    market::add_series(market, option_type, strike_price, expiry_ms, series_object_id);
    event::emit(SeriesCreated {
        series_id: series_object_id,
        market_id,
        option_type,
        strike_price,
        expiry_ms,
        exercise_window_end_ms,
        exception_window_end_ms,
    });
    transfer::share_object(series);
    series_object_id
}

public(package) fun new_expiry_price(
    market_id: ID,
    oracle: String,
    oracle_feed_id: vector<u8>,
    expiry_ms: u64,
    expiry_price: u64,
    publish_time_ms: u64,
    price_payload_hash: vector<u8>,
): ExpiryPrice {
    ExpiryPrice {
        market_id,
        oracle,
        oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
        price_payload_hash,
    }
}

public fun finalize_one<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
    clock: &Clock,
) {
    let ExpiryPrice {
        market_id,
        oracle,
        oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
        price_payload_hash,
    } = expiry_price;

    assert_expiry_price_for_market(
        market,
        market_id,
        &oracle,
        &oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
    );
    assert!(clock.timestamp_ms() >= expiry_ms, EExpiryNotReached);
    finalize(series, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
}

public fun finalize_two<QuoteCoin, BaseCoin>(
    market: &Market,
    first: &mut Series<QuoteCoin, BaseCoin>,
    second: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
    clock: &Clock,
) {
    let ExpiryPrice {
        market_id,
        oracle,
        oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
        price_payload_hash,
    } = expiry_price;

    assert_expiry_price_for_market(
        market,
        market_id,
        &oracle,
        &oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
    );
    assert!(clock.timestamp_ms() >= expiry_ms, EExpiryNotReached);
    finalize(first, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(second, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
}

public fun finalize_four<QuoteCoin, BaseCoin>(
    market: &Market,
    first: &mut Series<QuoteCoin, BaseCoin>,
    second: &mut Series<QuoteCoin, BaseCoin>,
    third: &mut Series<QuoteCoin, BaseCoin>,
    fourth: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
    clock: &Clock,
) {
    let ExpiryPrice {
        market_id,
        oracle,
        oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
        price_payload_hash,
    } = expiry_price;

    assert_expiry_price_for_market(
        market,
        market_id,
        &oracle,
        &oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
    );
    assert!(clock.timestamp_ms() >= expiry_ms, EExpiryNotReached);
    finalize(first, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(second, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(third, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(fourth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
}

public fun finalize_eight<QuoteCoin, BaseCoin>(
    market: &Market,
    first: &mut Series<QuoteCoin, BaseCoin>,
    second: &mut Series<QuoteCoin, BaseCoin>,
    third: &mut Series<QuoteCoin, BaseCoin>,
    fourth: &mut Series<QuoteCoin, BaseCoin>,
    fifth: &mut Series<QuoteCoin, BaseCoin>,
    sixth: &mut Series<QuoteCoin, BaseCoin>,
    seventh: &mut Series<QuoteCoin, BaseCoin>,
    eighth: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
    clock: &Clock,
) {
    let ExpiryPrice {
        market_id,
        oracle,
        oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
        price_payload_hash,
    } = expiry_price;

    assert_expiry_price_for_market(
        market,
        market_id,
        &oracle,
        &oracle_feed_id,
        expiry_ms,
        expiry_price,
        publish_time_ms,
    );
    assert!(clock.timestamp_ms() >= expiry_ms, EExpiryNotReached);
    finalize(first, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(second, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(third, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(fourth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(fifth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(sixth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(seventh, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize(eighth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
}

public(package) fun assert_open_for_underwriting<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    clock: &Clock,
) {
    assert!(series.state == STATE_OPEN, EExpiredSeries);
    let now_ms = clock.timestamp_ms();
    assert!(series.expiry_ms > now_ms, EExpiredSeries);
    assert!(series.expiry_ms - now_ms > MIN_UNDERWRITING_TIME_TO_EXPIRY_MS, EExpiredSeries);
}

public(package) fun record_call_underwriting<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
    quantity: u64,
    collateral: Balance<BaseCoin>,
) {
    let pool = &mut series.collateral_pool;
    pool.base_balance.join(collateral);
    pool.accounted_base_balance = pool.accounted_base_balance + quantity;
    add_seller_vault(series, seller, quantity, quantity);
}

public(package) fun record_put_underwriting<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
    quantity: u64,
    collateral_quantity: u64,
    collateral: Balance<QuoteCoin>,
) {
    let pool = &mut series.collateral_pool;
    pool.quote_balance.join(collateral);
    pool.accounted_quote_balance = pool.accounted_quote_balance + collateral_quantity;
    add_seller_vault(series, seller, quantity, collateral_quantity);
}

public fun phase<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>, clock: &Clock): u8 {
    if (series.state == STATE_OPEN) {
        if (clock.timestamp_ms() >= series.expiry_ms) {
            PHASE_PRICE_PENDING
        } else {
            PHASE_OPEN
        }
    } else if (series.state == STATE_CLOSED) {
        PHASE_FULL_SETTLEMENT
    } else if (!is_in_the_money(series)) {
        PHASE_NO_EXERCISE_EXPIRY
    } else if (total_exercised_quantity(series) == series.total_short_quantity) {
        PHASE_FULL_SETTLEMENT
    } else if (clock.timestamp_ms() <= series.exercise_window_end_ms) {
        PHASE_MANUAL_EXERCISE
    } else if (clock.timestamp_ms() <= series.exception_window_end_ms) {
        PHASE_EXERCISE_BY_EXCEPTION
    } else {
        PHASE_PARTIAL_SETTLEMENT
    }
}

public fun exercise_call<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    long: Long<QuoteCoin, BaseCoin>,
    payment: Coin<QuoteCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<BaseCoin> {
    assert!(series.option_type == OPTION_TYPE_CALL, EInvalidOptionType);
    assert_manual_exercise_ready(series, &long, clock);
    let quantity = burn_matching_long(series, long);
    assert!(quantity > 0, EInvalidExerciseQuantity);

    let payment_required = strike_payment(series, quantity);
    assert!(payment.value() == payment_required, EInvalidExercisePayment);
    assert!(series.collateral_pool.accounted_base_balance >= quantity, EInsufficientCollateral);
    assert!(series.collateral_pool.base_balance.value() >= quantity, EInsufficientCollateral);

    let pool = &mut series.collateral_pool;
    pool.quote_balance.join(payment.into_balance());
    pool.accounted_quote_balance = pool.accounted_quote_balance + payment_required;
    pool.accounted_base_balance = pool.accounted_base_balance - quantity;
    let payout = coin::from_balance(pool.base_balance.split(quantity), ctx);
    series.total_manual_exercised_quantity = series.total_manual_exercised_quantity + quantity;
    series.total_manual_exercise_quote_proceeds = series.total_manual_exercise_quote_proceeds + payment_required;
    event::emit(Exercised {
        series_id: object::id(series),
        holder: ctx.sender(),
        option_type: OPTION_TYPE_CALL,
        quantity,
        input_asset_amount: payment_required,
        output_asset_amount: quantity,
    });
    payout
}

public fun exercise_put<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    long: Long<QuoteCoin, BaseCoin>,
    payment: Coin<BaseCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<QuoteCoin> {
    assert!(series.option_type == OPTION_TYPE_PUT, EInvalidOptionType);
    assert_manual_exercise_ready(series, &long, clock);
    let quantity = burn_matching_long(series, long);
    assert!(quantity > 0, EInvalidExerciseQuantity);

    let quote_payout = strike_payment(series, quantity);
    assert!(payment.value() == quantity, EInvalidExercisePayment);
    assert!(series.collateral_pool.accounted_quote_balance >= quote_payout, EInsufficientCollateral);
    assert!(series.collateral_pool.quote_balance.value() >= quote_payout, EInsufficientCollateral);

    let pool = &mut series.collateral_pool;
    pool.base_balance.join(payment.into_balance());
    pool.accounted_base_balance = pool.accounted_base_balance + quantity;
    pool.accounted_quote_balance = pool.accounted_quote_balance - quote_payout;
    let payout = coin::from_balance(pool.quote_balance.split(quote_payout), ctx);
    series.total_manual_exercised_quantity = series.total_manual_exercised_quantity + quantity;
    series.total_manual_exercise_base_proceeds = series.total_manual_exercise_base_proceeds + quantity;
    event::emit(Exercised {
        series_id: object::id(series),
        holder: ctx.sender(),
        option_type: OPTION_TYPE_PUT,
        quantity,
        input_asset_amount: quantity,
        output_asset_amount: quote_payout,
    });
    payout
}

public fun settle_sellers<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    sellers: vector<address>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_seller_settlement_ready(series, clock);
    let mut settled_seller_count = 0;
    let mut base_paid_total = 0;
    let mut quote_paid_total = 0;
    sellers.do!(|seller| {
        let (base_paid, quote_paid) = settle_seller(series, seller, ctx);
        settled_seller_count = settled_seller_count + 1;
        base_paid_total = base_paid_total + base_paid;
        quote_paid_total = quote_paid_total + quote_paid;
    });
    if (series.seller_vault_index.is_empty()) {
        series.state = STATE_CLOSED;
    };
    event::emit(SeriesSettlementBatchCompleted {
        series_id: object::id(series),
        settled_seller_count,
        base_paid_total,
        quote_paid_total,
    });
}

fun assert_manual_exercise_ready<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    long: &Long<QuoteCoin, BaseCoin>,
    clock: &Clock,
) {
    assert!(phase(series, clock) == PHASE_MANUAL_EXERCISE, EInvalidExercisePhase);
    assert!(long::market_id(long) == series.market_id, ELongMismatch);
    assert!(long::series_id(long) == object::id(series), ELongMismatch);
    assert!(long::option_type(long) == series.option_type, ELongMismatch);
    assert!(long::strike_price(long) == series.strike_price, ELongMismatch);
    assert!(long::expiry_ms(long) == series.expiry_ms, ELongMismatch);
    assert!(long::quantity(long) > 0, EInvalidExerciseQuantity);
    assert!(total_exercised_quantity(series) + long::quantity(long) <= series.total_short_quantity, EInvalidExerciseQuantity);
}

fun burn_matching_long<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    long: Long<QuoteCoin, BaseCoin>,
): u64 {
    let (market_id, series_id, option_type, strike_price, expiry_ms, quantity) = long::burn(long);
    assert!(market_id == series.market_id, ELongMismatch);
    assert!(series_id == object::id(series), ELongMismatch);
    assert!(option_type == series.option_type, ELongMismatch);
    assert!(strike_price == series.strike_price, ELongMismatch);
    assert!(expiry_ms == series.expiry_ms, ELongMismatch);
    quantity
}

fun assert_seller_settlement_ready<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    clock: &Clock,
) {
    let current_phase = phase(series, clock);
    assert!(
        current_phase == PHASE_NO_EXERCISE_EXPIRY
            || (current_phase == PHASE_FULL_SETTLEMENT && clock.timestamp_ms() > series.exercise_window_end_ms),
        EInvalidSettlementPhase,
    );
}

fun settle_seller<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
    ctx: &mut TxContext,
): (u64, u64) {
    let key = SellerVaultKey(seller);
    assert!(dynamic_field::exists(&series.id, key), ESellerVaultMissing);
    let SellerVault { seller, series_id, short_quantity, collateral_quantity, settlement_state } =
        dynamic_field::remove<SellerVaultKey, SellerVault>(&mut series.id, key);
    assert!(series_id == object::id(series), ESellerVaultMissing);
    assert!(settlement_state == STATE_OPEN, ESellerVaultAlreadySettled);

    remove_seller_from_index(series, seller);
    let (base_paid, quote_paid) = if (!is_in_the_money(series)) {
        settle_original_collateral(series, seller, collateral_quantity, ctx)
    } else {
        settle_exercise_proceeds(series, seller, short_quantity, ctx)
    };
    event::emit(SellerPayoutSettled {
        series_id: object::id(series),
        seller,
        short_quantity,
        base_paid,
        quote_paid,
    });
    (base_paid, quote_paid)
}

fun settle_original_collateral<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
    collateral_quantity: u64,
    ctx: &mut TxContext,
): (u64, u64) {
    let pool = &mut series.collateral_pool;
    if (series.option_type == OPTION_TYPE_CALL) {
        assert!(pool.accounted_base_balance >= collateral_quantity, EInsufficientCollateral);
        assert!(pool.base_balance.value() >= collateral_quantity, EInsufficientCollateral);
        pool.accounted_base_balance = pool.accounted_base_balance - collateral_quantity;
        transfer::public_transfer(coin::from_balance(pool.base_balance.split(collateral_quantity), ctx), seller);
        (collateral_quantity, 0)
    } else {
        assert!(pool.accounted_quote_balance >= collateral_quantity, EInsufficientCollateral);
        assert!(pool.quote_balance.value() >= collateral_quantity, EInsufficientCollateral);
        pool.accounted_quote_balance = pool.accounted_quote_balance - collateral_quantity;
        transfer::public_transfer(coin::from_balance(pool.quote_balance.split(collateral_quantity), ctx), seller);
        (0, collateral_quantity)
    }
}

fun settle_exercise_proceeds<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
    short_quantity: u64,
    ctx: &mut TxContext,
): (u64, u64) {
    let pool = &mut series.collateral_pool;
    if (series.option_type == OPTION_TYPE_CALL) {
        let payout = pro_rata(series.total_manual_exercise_quote_proceeds, short_quantity, series.total_short_quantity);
        assert!(pool.accounted_quote_balance >= payout, EInsufficientCollateral);
        assert!(pool.quote_balance.value() >= payout, EInsufficientCollateral);
        pool.accounted_quote_balance = pool.accounted_quote_balance - payout;
        transfer::public_transfer(coin::from_balance(pool.quote_balance.split(payout), ctx), seller);
        (0, payout)
    } else {
        let payout = pro_rata(series.total_manual_exercise_base_proceeds, short_quantity, series.total_short_quantity);
        assert!(pool.accounted_base_balance >= payout, EInsufficientCollateral);
        assert!(pool.base_balance.value() >= payout, EInsufficientCollateral);
        pool.accounted_base_balance = pool.accounted_base_balance - payout;
        transfer::public_transfer(coin::from_balance(pool.base_balance.split(payout), ctx), seller);
        (payout, 0)
    }
}

fun remove_seller_from_index<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
) {
    let mut index = 0;
    let mut found = false;
    while (index < series.seller_vault_index.length()) {
        if (series.seller_vault_index[index] == seller) {
            series.seller_vault_index.remove(index);
            found = true;
            break
        };
        index = index + 1;
    };
    assert!(found, ESellerVaultMissing);
}

fun strike_payment<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    quantity: u64,
): u64 {
    let numerator =
        (quantity as u256)
        * (series.strike_price as u256)
        * (pow10(series.quote_decimals) as u256);
    let denominator = (pow10(series.base_decimals) as u256) * (series.strike_scale as u256);
    (((numerator + denominator - 1) / denominator) as u64)
}

fun pro_rata(total: u64, quantity: u64, denominator: u64): u64 {
    (((total as u256) * (quantity as u256) / (denominator as u256)) as u64)
}

fun pow10(decimals: u8): u64 {
    let mut result = 1;
    decimals.do!(|_| {
        result = result * 10;
    });
    result
}

fun assert_expiry_price_for_market(
    market: &Market,
    market_id: ID,
    oracle: &String,
    oracle_feed_id: &vector<u8>,
    expiry_ms: u64,
    expiry_price: u64,
    publish_time_ms: u64,
) {
    assert!(market_id == market::id(market), EExpiryPriceMismatch);
    assert!(*oracle == market::oracle(market), EExpiryPriceMismatch);
    assert!(*oracle_feed_id == *market::oracle_feed_id(market), EExpiryPriceMismatch);
    assert!(expiry_price > 0, EInvalidExpiryPrice);
    assert!(publish_time_ms >= expiry_ms, EStaleExpiryPrice);
}

fun finalize<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    market_id: ID,
    oracle: &String,
    oracle_feed_id: &vector<u8>,
    expiry_ms: u64,
    expiry_price: u64,
    publish_time_ms: u64,
    price_payload_hash: &vector<u8>,
) {
    assert!(series.state == STATE_OPEN, EExpiryPriceAlreadyFinalized);
    assert!(series.market_id == market_id, EExpiryPriceMismatch);
    assert!(series.expiry_ms == expiry_ms, EExpiryPriceMismatch);

    series.expiry_price = option::some(expiry_price);
    series.expiry_price_publish_time_ms = option::some(publish_time_ms);
    series.state = STATE_EXPIRATION_PRICE_FINALIZED;

    event::emit(ExpiryPriceFinalized {
        series_id: object::id(series),
        oracle: *oracle,
        oracle_feed_id: *oracle_feed_id,
        expiry_price,
        publish_time_ms,
        price_payload_hash: *price_payload_hash,
    });
}

fun is_in_the_money<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): bool {
    let expiry_price = *series.expiry_price.borrow();
    if (series.option_type == OPTION_TYPE_CALL) {
        expiry_price > series.strike_price
    } else {
        expiry_price < series.strike_price
    }
}

fun total_exercised_quantity<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.total_manual_exercised_quantity + series.total_exercise_by_exception_quantity
}

#[test_only]
public fun set_exercised_quantities_for_testing<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    manual_quantity: u64,
    exercise_by_exception_quantity: u64,
) {
    series.total_manual_exercised_quantity = manual_quantity;
    series.total_exercise_by_exception_quantity = exercise_by_exception_quantity;
}

fun add_seller_vault<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    seller: address,
    quantity: u64,
    collateral_quantity: u64,
) {
    let key = SellerVaultKey(seller);
    if (dynamic_field::exists(&series.id, key)) {
        let vault = dynamic_field::borrow_mut<SellerVaultKey, SellerVault>(&mut series.id, key);
        vault.short_quantity = vault.short_quantity + quantity;
        vault.collateral_quantity = vault.collateral_quantity + collateral_quantity;
    } else {
        let series_id = object::id(series);
        dynamic_field::add(&mut series.id, key, SellerVault {
            seller,
            series_id,
            short_quantity: quantity,
            collateral_quantity,
            settlement_state: STATE_OPEN,
        });
        series.seller_vault_index.push_back(seller);
    };
    series.total_short_quantity = series.total_short_quantity + quantity;
}

public fun option_type_call(): u8 {
    OPTION_TYPE_CALL
}

public fun option_type_put(): u8 {
    OPTION_TYPE_PUT
}

public fun state_open(): u8 {
    STATE_OPEN
}

public fun state_expiration_price_finalized(): u8 {
    STATE_EXPIRATION_PRICE_FINALIZED
}

public fun state_closed(): u8 {
    STATE_CLOSED
}

public fun phase_open(): u8 {
    PHASE_OPEN
}

public fun phase_price_pending(): u8 {
    PHASE_PRICE_PENDING
}

public fun phase_no_exercise_expiry(): u8 {
    PHASE_NO_EXERCISE_EXPIRY
}

public fun phase_manual_exercise(): u8 {
    PHASE_MANUAL_EXERCISE
}

public fun phase_exercise_by_exception(): u8 {
    PHASE_EXERCISE_BY_EXCEPTION
}

public fun phase_partial_settlement(): u8 {
    PHASE_PARTIAL_SETTLEMENT
}

public fun phase_full_settlement(): u8 {
    PHASE_FULL_SETTLEMENT
}

public fun exercise_window_ms(): u64 {
    EXERCISE_WINDOW_MS
}

public fun exception_window_ms(): u64 {
    EXCEPTION_WINDOW_MS
}

public fun min_underwriting_time_to_expiry_ms(): u64 {
    MIN_UNDERWRITING_TIME_TO_EXPIRY_MS
}

public fun market_id<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): ID {
    series.market_id
}

public fun option_type<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u8 {
    series.option_type
}

public fun strike_price<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.strike_price
}

public fun quote_decimals<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u8 {
    series.quote_decimals
}

public fun base_decimals<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u8 {
    series.base_decimals
}

public fun strike_scale<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.strike_scale
}

public fun max_operational_fee_bps<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.max_operational_fee_bps
}

public fun expiry_ms<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.expiry_ms
}

public fun exercise_window_end_ms<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.exercise_window_end_ms
}

public fun exception_window_end_ms<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.exception_window_end_ms
}

public fun total_short_quantity<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.total_short_quantity
}

public fun total_manual_exercised_quantity<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.total_manual_exercised_quantity
}

public fun total_exercise_by_exception_quantity<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.total_exercise_by_exception_quantity
}

public fun total_manual_exercise_base_proceeds<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.total_manual_exercise_base_proceeds
}

public fun total_manual_exercise_quote_proceeds<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.total_manual_exercise_quote_proceeds
}

public fun seller_vault_count<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.seller_vault_index.length()
}

public fun seller_short_quantity<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    seller: address,
): u64 {
    seller_vault(series, seller).short_quantity
}

public fun seller_collateral_quantity<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    seller: address,
): u64 {
    seller_vault(series, seller).collateral_quantity
}

public fun seller_settlement_state<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    seller: address,
): u8 {
    seller_vault(series, seller).settlement_state
}

public fun state<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u8 {
    series.state
}

public fun expiry_price<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    *series.expiry_price.borrow()
}

public fun expiry_price_publish_time_ms<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    *series.expiry_price_publish_time_ms.borrow()
}

public fun collateral_base_balance<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.collateral_pool.base_balance.value()
}

public fun collateral_quote_balance<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.collateral_pool.quote_balance.value()
}

public fun accounted_base_balance<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.collateral_pool.accounted_base_balance
}

public fun accounted_quote_balance<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    series.collateral_pool.accounted_quote_balance
}

public fun excess_base_balance<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    collateral_base_balance(series) - accounted_base_balance(series)
}

public fun excess_quote_balance<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u64 {
    collateral_quote_balance(series) - accounted_quote_balance(series)
}

fun seller_vault<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    seller: address,
): &SellerVault {
    let key = SellerVaultKey(seller);
    assert!(dynamic_field::exists(&series.id, key), ESellerVaultMissing);
    dynamic_field::borrow<SellerVaultKey, SellerVault>(&series.id, key)
}
