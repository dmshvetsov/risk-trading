module options_trading_protocol::series;

use options_trading_protocol::market::{Self, Market};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::event;

const OPTION_TYPE_CALL: u8 = 0;
const OPTION_TYPE_PUT: u8 = 1;

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

public struct Series<phantom QuoteCoin, phantom BaseCoin> has key {
    id: UID,
    market_id: ID,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    exercise_window_end_ms: u64,
    exception_window_end_ms: u64,
    total_short_quantity: u64,
    total_manual_exercised_quantity: u64,
    total_exercise_by_exception_quantity: u64,
    expiry_price: Option<u64>,
    expiry_price_publish_time_ms: Option<u64>,
    collateral_pool_id: ID,
    state: u8,
}

public struct CollateralPool<phantom QuoteCoin, phantom BaseCoin> has key {
    id: UID,
    series_id: ID,
    base_balance: Balance<BaseCoin>,
    quote_balance: Balance<QuoteCoin>,
    accounted_base_balance: u64,
    accounted_quote_balance: u64,
}

public struct SeriesCreated has copy, drop {
    series_id: ID,
    market_id: ID,
    collateral_pool_id: ID,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    exercise_window_end_ms: u64,
    exception_window_end_ms: u64,
}

public fun create_series<QuoteCoin, BaseCoin>(
    market: &mut Market,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (ID, ID) {
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
    let pool_id = object::new(ctx);
    let series_object_id = object::uid_to_inner(&series_id);
    let pool_object_id = object::uid_to_inner(&pool_id);
    let market_id = market::id(market);

    let series = Series<QuoteCoin, BaseCoin> {
        id: series_id,
        market_id,
        option_type,
        strike_price,
        expiry_ms,
        exercise_window_end_ms,
        exception_window_end_ms,
        total_short_quantity: 0,
        total_manual_exercised_quantity: 0,
        total_exercise_by_exception_quantity: 0,
        expiry_price: option::none(),
        expiry_price_publish_time_ms: option::none(),
        collateral_pool_id: pool_object_id,
        state: STATE_OPEN,
    };
    let pool = CollateralPool<QuoteCoin, BaseCoin> {
        id: pool_id,
        series_id: series_object_id,
        base_balance: balance::zero(),
        quote_balance: balance::zero(),
        accounted_base_balance: 0,
        accounted_quote_balance: 0,
    };

    market::add_series(market, option_type, strike_price, expiry_ms, series_object_id);
    event::emit(SeriesCreated {
        series_id: series_object_id,
        market_id,
        collateral_pool_id: pool_object_id,
        option_type,
        strike_price,
        expiry_ms,
        exercise_window_end_ms,
        exception_window_end_ms,
    });
    transfer::share_object(series);
    transfer::share_object(pool);
    (series_object_id, pool_object_id)
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
    } else {
        PHASE_PRICE_PENDING
    }
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

public fun collateral_pool_id<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): ID {
    series.collateral_pool_id
}

public fun state<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): u8 {
    series.state
}

public fun series_id<QuoteCoin, BaseCoin>(pool: &CollateralPool<QuoteCoin, BaseCoin>): ID {
    pool.series_id
}

public fun accounted_base_balance<QuoteCoin, BaseCoin>(pool: &CollateralPool<QuoteCoin, BaseCoin>): u64 {
    pool.accounted_base_balance
}

public fun accounted_quote_balance<QuoteCoin, BaseCoin>(pool: &CollateralPool<QuoteCoin, BaseCoin>): u64 {
    pool.accounted_quote_balance
}
