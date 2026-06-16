#[test_only]
module options_trading_protocol::series_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::series::{Self, CollateralPool, Series};
use std::unit_test::{assert_eq};
use sui::clock;
use sui::test_scenario;

public struct QUOTE has drop {}
public struct BASE has drop {}
public struct OTHER has drop {}

const ADMIN: address = @0xA;
const USER: address = @0xB;
const NOW_MS: u64 = 10_000;
const EXPIRY_MS: u64 = 20_000;
const STRIKE_PRICE: u64 = 350_000_000;
const OPTION_TYPE_CALL: u8 = 0;
const OPTION_TYPE_PUT: u8 = 1;
const STATE_OPEN: u8 = 0;
const PHASE_OPEN: u8 = 0;
const PHASE_PRICE_PENDING: u8 = 1;
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
fun past_expiry_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(EXPIRY_MS, scenario.ctx());
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
