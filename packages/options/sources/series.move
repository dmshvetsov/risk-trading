module options_trading_protocol::series;

use options_trading_protocol::market::{Self, Market};
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::dynamic_field;
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
const EPoolMismatch: u64 = 4;
const ESellerVaultMissing: u64 = 5;
const EInvalidExpiryPrice: u64 = 6;
const EStaleExpiryPrice: u64 = 7;
const EExpiryPriceMismatch: u64 = 8;
const EExpiryPriceAlreadyFinalized: u64 = 9;

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
    expiry_price: Option<u64>,
    expiry_price_publish_time_ms: Option<u64>,
    expiry_price_payload_hash: Option<vector<u8>>,
    collateral_pool_id: ID,
    seller_vault_index: vector<address>,
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
        expiry_price: option::none(),
        expiry_price_publish_time_ms: option::none(),
        expiry_price_payload_hash: option::none(),
        collateral_pool_id: pool_object_id,
        seller_vault_index: vector[],
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

public fun finalize<QuoteCoin, BaseCoin>(
    market: &Market,
    series: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
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
    finalize_one(series, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
}

public fun finalize_two<QuoteCoin, BaseCoin>(
    market: &Market,
    first: &mut Series<QuoteCoin, BaseCoin>,
    second: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
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
    finalize_one(first, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(second, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
}

public fun finalize_four<QuoteCoin, BaseCoin>(
    market: &Market,
    first: &mut Series<QuoteCoin, BaseCoin>,
    second: &mut Series<QuoteCoin, BaseCoin>,
    third: &mut Series<QuoteCoin, BaseCoin>,
    fourth: &mut Series<QuoteCoin, BaseCoin>,
    expiry_price: ExpiryPrice,
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
    finalize_one(first, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(second, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(third, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(fourth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
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
    finalize_one(first, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(second, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(third, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(fourth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(fifth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(sixth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(seventh, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
    finalize_one(eighth, market_id, &oracle, &oracle_feed_id, expiry_ms, expiry_price, publish_time_ms, &price_payload_hash);
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
    pool: &mut CollateralPool<QuoteCoin, BaseCoin>,
    seller: address,
    quantity: u64,
    collateral: Balance<BaseCoin>,
) {
    assert_pool_for_series(series, pool);
    pool.base_balance.join(collateral);
    pool.accounted_base_balance = pool.accounted_base_balance + quantity;
    add_seller_vault(series, seller, quantity, quantity);
}

public(package) fun record_put_underwriting<QuoteCoin, BaseCoin>(
    series: &mut Series<QuoteCoin, BaseCoin>,
    pool: &mut CollateralPool<QuoteCoin, BaseCoin>,
    seller: address,
    quantity: u64,
    collateral_quantity: u64,
    collateral: Balance<QuoteCoin>,
) {
    assert_pool_for_series(series, pool);
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

fun finalize_one<QuoteCoin, BaseCoin>(
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
    series.expiry_price_payload_hash = option::some(*price_payload_hash);
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

fun assert_pool_for_series<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    pool: &CollateralPool<QuoteCoin, BaseCoin>,
) {
    assert!(pool.series_id == object::id(series), EPoolMismatch);
    assert!(series.collateral_pool_id == object::id(pool), EPoolMismatch);
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

public fun collateral_pool_id<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): ID {
    series.collateral_pool_id
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

public fun expiry_price_payload_hash<QuoteCoin, BaseCoin>(series: &Series<QuoteCoin, BaseCoin>): vector<u8> {
    *series.expiry_price_payload_hash.borrow()
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

fun seller_vault<QuoteCoin, BaseCoin>(
    series: &Series<QuoteCoin, BaseCoin>,
    seller: address,
): &SellerVault {
    let key = SellerVaultKey(seller);
    assert!(dynamic_field::exists(&series.id, key), ESellerVaultMissing);
    dynamic_field::borrow<SellerVaultKey, SellerVault>(&series.id, key)
}
