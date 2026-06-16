#[test_only]
module options_trading_protocol::series_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::pyth_oracle_unverifiable;
use options_trading_protocol::series::{Self, CollateralPool, Series};
use std::unit_test::{assert_eq};
use sui::balance;
use sui::clock;
use sui::test_scenario;

public struct QUOTE has drop {}
public struct BASE has drop {}
public struct OTHER has drop {}

const ADMIN: address = @0xA;
const USER: address = @0xB;
const NOW_MS: u64 = 10_000;
const MIN_UNDERWRITING_TIME_TO_EXPIRY_MS: u64 = 8 * 60 * 60 * 1000;
const EXPIRY_MS: u64 = NOW_MS + MIN_UNDERWRITING_TIME_TO_EXPIRY_MS + 1;
const STRIKE_PRICE: u64 = 350_000_000;
const OPTION_TYPE_CALL: u8 = 0;
const OPTION_TYPE_PUT: u8 = 1;
const STATE_OPEN: u8 = 0;
const STATE_EXPIRATION_PRICE_FINALIZED: u8 = 1;
const PHASE_OPEN: u8 = 0;
const PHASE_PRICE_PENDING: u8 = 1;
const PHASE_NO_EXERCISE_EXPIRY: u8 = 2;
const PHASE_MANUAL_EXERCISE: u8 = 3;
const EXERCISE_WINDOW_MS: u64 = 60 * 60 * 1000;
const EXCEPTION_WINDOW_MS: u64 = 60 * 60 * 1000;

fun create_market_fixture(): (test_scenario::Scenario, ID) {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market_id = market::create_market<QUOTE, BASE>(
        &cap,
        "SUI",
        "pyth",
        b"feed-sui-usdc",
        6,
        9,
        100_000_000,
        500,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);
    (scenario, market_id)
}

fun clock_at(timestamp_ms: u64, ctx: &mut TxContext): clock::Clock {
    let mut now = clock::create_for_testing(ctx);
    now.set_for_testing(timestamp_ms);
    now
}

#[test]
fun anyone_can_create_call_series_with_isolated_collateral_pool() {
    let (mut scenario, market_id) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, pool_id) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(USER);
    let series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);

    assert_eq!(series::market_id(&series), market_id);
    assert_eq!(series::option_type(&series), OPTION_TYPE_CALL);
    assert_eq!(series::strike_price(&series), STRIKE_PRICE);
    assert_eq!(series::max_operational_fee_bps(&series), 500);
    assert_eq!(series::expiry_ms(&series), EXPIRY_MS);
    assert_eq!(series::exercise_window_end_ms(&series), EXPIRY_MS + EXERCISE_WINDOW_MS);
    assert_eq!(series::exception_window_end_ms(&series), EXPIRY_MS + EXERCISE_WINDOW_MS + EXCEPTION_WINDOW_MS);
    assert_eq!(series::state(&series), STATE_OPEN);
    assert_eq!(series::total_short_quantity(&series), 0);
    assert_eq!(series::total_manual_exercised_quantity(&series), 0);
    assert_eq!(series::total_exercise_by_exception_quantity(&series), 0);
    assert_eq!(series::collateral_pool_id(&series), pool_id);
    assert_eq!(series::series_id(&pool), series_id);
    assert_eq!(series::accounted_base_balance(&pool), 0);
    assert_eq!(series::accounted_quote_balance(&pool), 0);

    test_scenario::return_shared(series);
    test_scenario::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidOptionType, location = series)]
fun invalid_option_type_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (_, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        3,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidStrike, location = series)]
fun zero_strike_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (_, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        0,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EExpiredSeries, location = series)]
fun expiry_at_underwriting_cutoff_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (_, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        NOW_MS + MIN_UNDERWRITING_TIME_TO_EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    scenario.end();
}

#[test, expected_failure(abort_code = market::EUnsupportedCoinTypes, location = market)]
fun unsupported_market_coin_types_abort() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (_, _) = series::create_series<OTHER, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EDuplicateSeries, location = series)]
fun duplicate_market_type_strike_expiry_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (_, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let (_, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    scenario.end();
}

#[test]
fun expiry_phase_is_derived_from_state_and_timing() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let mut now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    test_scenario::return_shared(market);

    scenario.next_tx(USER);
    let series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    assert_eq!(series::phase(&series, &now), PHASE_OPEN);

    now.set_for_testing(EXPIRY_MS);
    assert_eq!(series::phase(&series, &now), PHASE_PRICE_PENDING);

    now.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun admin_can_finalize_expiry_price_from_pyth_adapter() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"benchmark-payload-hash",
    );
    series::finalize(&market, &mut series, price);

    assert_eq!(series::state(&series), STATE_EXPIRATION_PRICE_FINALIZED);
    assert_eq!(series::expiry_price(&series), STRIKE_PRICE + 1);
    assert_eq!(series::expiry_price_publish_time_ms(&series), EXPIRY_MS);
    assert_eq!(series::expiry_price_payload_hash(&series), b"benchmark-payload-hash");

    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun one_expiry_price_can_finalize_matching_series_batch() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (call_series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let (put_series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut call_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(call_series_id);
    let mut put_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(put_series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"batch-payload-hash",
    );
    series::finalize_two(&market, &mut call_series, &mut put_series, price);

    assert_eq!(series::state(&call_series), STATE_EXPIRATION_PRICE_FINALIZED);
    assert_eq!(series::state(&put_series), STATE_EXPIRATION_PRICE_FINALIZED);
    assert_eq!(series::expiry_price(&call_series), STRIKE_PRICE + 1);
    assert_eq!(series::expiry_price(&put_series), STRIKE_PRICE + 1);

    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(call_series);
    test_scenario::return_shared(put_series);
    scenario.end();
}

#[test]
fun finalized_price_drives_post_expiry_phase() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let mut now = clock_at(NOW_MS, scenario.ctx());
    let (call_series_id, call_pool_id) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let (put_series_id, put_pool_id) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS + 1,
        &now,
        scenario.ctx(),
    );
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut call_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(call_series_id);
    let mut call_pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(call_pool_id);
    let mut put_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(put_series_id);
    let mut put_pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(put_pool_id);
    series::record_call_underwriting(&mut call_series, &mut call_pool, USER, 1, balance::zero());
    series::record_put_underwriting(&mut put_series, &mut put_pool, USER, 1, 1, balance::zero());
    let call_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"call-payload-hash",
    );
    let put_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS + 1,
        STRIKE_PRICE + 1,
        EXPIRY_MS + 1,
        b"put-payload-hash",
    );
    series::finalize(&market, &mut call_series, call_price);
    series::finalize(&market, &mut put_series, put_price);

    now.set_for_testing(EXPIRY_MS);
    assert_eq!(series::phase(&call_series, &now), PHASE_MANUAL_EXERCISE);
    now.set_for_testing(EXPIRY_MS + 1);
    assert_eq!(series::phase(&put_series, &now), PHASE_NO_EXERCISE_EXPIRY);

    now.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(call_series);
    test_scenario::return_shared(call_pool);
    test_scenario::return_shared(put_series);
    test_scenario::return_shared(put_pool);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExpiryPrice, location = series)]
fun zero_expiry_price_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        0,
        EXPIRY_MS,
        b"payload-hash",
    );
    series::finalize(&market, &mut series, price);
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EStaleExpiryPrice, location = series)]
fun publish_time_before_expiry_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS - 1,
        b"payload-hash",
    );
    series::finalize(&market, &mut series, price);
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EExpiryPriceMismatch, location = series)]
fun oracle_feed_mismatch_aborts() {
    let (mut scenario, market_id) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, _) = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let market = scenario.take_shared<Market>();
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let price = series::new_expiry_price(
        market_id,
        "pyth",
        b"wrong-feed",
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"payload-hash",
    );
    series::finalize(&market, &mut series, price);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}
