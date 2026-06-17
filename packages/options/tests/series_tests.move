#[test_only]
module options_trading_protocol::series_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::pyth_oracle_unverifiable;
use options_trading_protocol::series::{Self, Series};
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
const OPTION_TYPE_CALL: u8 = 1;
const OPTION_TYPE_PUT: u8 = 2;
const STATE_OPEN: u8 = 0;
const STATE_EXPIRATION_PRICE_FINALIZED: u8 = 1;
const PHASE_OPEN: u8 = 0;
const PHASE_PRICE_PENDING: u8 = 1;
const PHASE_NO_EXERCISE_EXPIRY: u8 = 2;
const PHASE_MANUAL_EXERCISE: u8 = 3;
const PHASE_EXERCISE_BY_EXCEPTION: u8 = 4;
const PHASE_PARTIAL_SETTLEMENT: u8 = 5;
const PHASE_FULL_SETTLEMENT: u8 = 6;
const EXERCISE_WINDOW_MS: u64 = 60 * 60 * 1000;
const EXCEPTION_WINDOW_MS: u64 = 60 * 60 * 1000;

fun create_market_fixture(): (test_scenario::Scenario, ID) {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());

    scenario.next_tx(ADMIN);
    let mut cap = scenario.take_from_sender<AdminCap>();
    let market_id = market::create_market<QUOTE, BASE>(
        &mut cap,
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
fun anyone_can_create_call_series_with_internal_collateral_pool() {
    let (mut scenario, market_id) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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

    assert_eq!(series::market_id(&series), market_id);
    assert_eq!(series::option_type_call(), OPTION_TYPE_CALL);
    assert_eq!(series::option_type_put(), OPTION_TYPE_PUT);
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
    assert_eq!(series::collateral_base_balance(&series), 0);
    assert_eq!(series::collateral_quote_balance(&series), 0);
    assert_eq!(series::accounted_base_balance(&series), 0);
    assert_eq!(series::accounted_quote_balance(&series), 0);
    assert_eq!(series::excess_base_balance(&series), 0);
    assert_eq!(series::excess_quote_balance(&series), 0);

    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EOrderAlreadyConsumed, location = series)]
fun signed_order_cannot_be_consumed_twice() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let order_hash = x"010203";
    series::consume_order(&mut series, order_hash);
    assert!(series::is_order_consumed(&series, order_hash));
    series::consume_order(&mut series, order_hash);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = market::EPaused, location = market)]
fun paused_market_rejects_series_creation() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let mut market = scenario.take_shared<Market>();
    market::pause(&mut market, &cap, scenario.ctx());
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let _ = series::create_series<QUOTE, BASE>(
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

#[test, expected_failure(abort_code = series::EInvalidOptionType, location = series)]
fun invalid_option_type_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let _ = series::create_series<QUOTE, BASE>(
        &mut market,
        0,
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
    let _ = series::create_series<QUOTE, BASE>(
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
    let _ = series::create_series<QUOTE, BASE>(
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
    let _ = series::create_series<OTHER, BASE>(
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
    let _ = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let _ = series::create_series<QUOTE, BASE>(
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
    let series_id = series::create_series<QUOTE, BASE>(
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
    let series_id = series::create_series<QUOTE, BASE>(
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
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);

    assert_eq!(series::state(&series), STATE_EXPIRATION_PRICE_FINALIZED);
    assert_eq!(series::expiry_price(&series), STRIKE_PRICE + 1);
    assert_eq!(series::expiry_price_publish_time_ms(&series), EXPIRY_MS);

    expiry_clock.destroy_for_testing();
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
    let call_series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let put_series_id = series::create_series<QUOTE, BASE>(
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
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_two(&market, &mut call_series, &mut put_series, price, &expiry_clock);

    assert_eq!(series::state(&call_series), STATE_EXPIRATION_PRICE_FINALIZED);
    assert_eq!(series::state(&put_series), STATE_EXPIRATION_PRICE_FINALIZED);
    assert_eq!(series::expiry_price(&call_series), STRIKE_PRICE + 1);
    assert_eq!(series::expiry_price(&put_series), STRIKE_PRICE + 1);

    expiry_clock.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(call_series);
    test_scenario::return_shared(put_series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EExpiryNotReached, location = series)]
fun finalization_before_expiry_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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
        b"payload-hash",
    );
    let before_expiry = clock_at(EXPIRY_MS - 1, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &before_expiry);
    before_expiry.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EExpiryPriceMismatch, location = series)]
fun batch_finalization_rejects_series_from_different_market() {
    let (mut scenario, first_market_id) = create_market_fixture();

    scenario.next_tx(ADMIN);
    let mut cap = scenario.take_from_sender<AdminCap>();
    let second_market_id = market::create_market<QUOTE, BASE>(
        &mut cap,
        "BTC",
        "pyth",
        b"feed-btc-usdc",
        6,
        8,
        100_000_000,
        500,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(USER);
    let mut first_market = scenario.take_shared_by_id<Market>(first_market_id);
    let mut second_market = scenario.take_shared_by_id<Market>(second_market_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let first_series_id = series::create_series<QUOTE, BASE>(
        &mut first_market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let second_series_id = series::create_series<QUOTE, BASE>(
        &mut second_market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(first_market);
    test_scenario::return_shared(second_market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared_by_id<Market>(first_market_id);
    let mut first_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(first_series_id);
    let mut second_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(second_series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"batch-payload-hash",
    );
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_two(&market, &mut first_series, &mut second_series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(first_series);
    test_scenario::return_shared(second_series);
    scenario.end();
}

#[test]
fun finalized_price_drives_post_expiry_phase() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let mut now = clock_at(NOW_MS, scenario.ctx());
    let call_series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let put_series_id = series::create_series<QUOTE, BASE>(
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
    let mut put_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(put_series_id);
    series::record_call_underwriting(&mut call_series, USER, 1, balance::zero());
    series::record_put_underwriting(&mut put_series, USER, 1, 1, balance::zero());
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
    now.set_for_testing(EXPIRY_MS + 1);
    series::finalize_one(&market, &mut call_series, call_price, &now);
    series::finalize_one(&market, &mut put_series, put_price, &now);

    assert_eq!(series::phase(&call_series, &now), PHASE_MANUAL_EXERCISE);
    assert_eq!(series::phase(&put_series, &now), PHASE_NO_EXERCISE_EXPIRY);

    now.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(call_series);
    test_scenario::return_shared(put_series);
    scenario.end();
}

#[test]
fun itm_phase_progresses_through_exception_partial_and_full_settlement() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let mut now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    series::record_call_underwriting(&mut series, USER, 10, balance::zero());
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"payload-hash",
    );
    now.set_for_testing(EXPIRY_MS);
    series::finalize_one(&market, &mut series, price, &now);
    assert_eq!(series::phase(&series, &now), PHASE_MANUAL_EXERCISE);

    now.set_for_testing(EXPIRY_MS + EXERCISE_WINDOW_MS + 1);
    assert_eq!(series::phase(&series, &now), PHASE_EXERCISE_BY_EXCEPTION);

    now.set_for_testing(EXPIRY_MS + EXERCISE_WINDOW_MS + EXCEPTION_WINDOW_MS + 1);
    assert_eq!(series::phase(&series, &now), PHASE_PARTIAL_SETTLEMENT);

    series::set_exercised_quantities_for_testing(&mut series, 4, 6);
    assert_eq!(series::phase(&series, &now), PHASE_FULL_SETTLEMENT);

    now.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun put_itm_phase_progresses_through_exception_partial_and_full_settlement() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let mut now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    series::record_put_underwriting(&mut series, USER, 10, 10, balance::zero());
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE - 1,
        EXPIRY_MS,
        b"payload-hash",
    );
    now.set_for_testing(EXPIRY_MS);
    series::finalize_one(&market, &mut series, price, &now);
    assert_eq!(series::phase(&series, &now), PHASE_MANUAL_EXERCISE);

    now.set_for_testing(EXPIRY_MS + EXERCISE_WINDOW_MS + 1);
    assert_eq!(series::phase(&series, &now), PHASE_EXERCISE_BY_EXCEPTION);

    now.set_for_testing(EXPIRY_MS + EXERCISE_WINDOW_MS + EXCEPTION_WINDOW_MS + 1);
    assert_eq!(series::phase(&series, &now), PHASE_PARTIAL_SETTLEMENT);

    series::set_exercised_quantities_for_testing(&mut series, 3, 7);
    assert_eq!(series::phase(&series, &now), PHASE_FULL_SETTLEMENT);

    now.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun atm_and_otm_series_expire_without_exercise_for_calls_and_puts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let mut now = clock_at(NOW_MS, scenario.ctx());
    let call_atm_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let call_otm_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let put_atm_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    let put_otm_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_PUT,
        STRIKE_PRICE - 1,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    test_scenario::return_shared(market);

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared<Market>();
    let mut call_atm = scenario.take_shared_by_id<Series<QUOTE, BASE>>(call_atm_id);
    let mut call_otm = scenario.take_shared_by_id<Series<QUOTE, BASE>>(call_otm_id);
    let mut put_atm = scenario.take_shared_by_id<Series<QUOTE, BASE>>(put_atm_id);
    let mut put_otm = scenario.take_shared_by_id<Series<QUOTE, BASE>>(put_otm_id);
    now.set_for_testing(EXPIRY_MS);
    let call_atm_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE,
        EXPIRY_MS,
        b"call-atm-payload-hash",
    );
    let call_otm_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE,
        EXPIRY_MS,
        b"call-otm-payload-hash",
    );
    let put_atm_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE,
        EXPIRY_MS,
        b"put-atm-payload-hash",
    );
    let put_otm_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE,
        EXPIRY_MS,
        b"put-otm-payload-hash",
    );
    series::finalize_one(&market, &mut call_atm, call_atm_price, &now);
    series::finalize_one(&market, &mut call_otm, call_otm_price, &now);
    series::finalize_one(&market, &mut put_atm, put_atm_price, &now);
    series::finalize_one(&market, &mut put_otm, put_otm_price, &now);

    assert_eq!(series::phase(&call_atm, &now), PHASE_NO_EXERCISE_EXPIRY);
    assert_eq!(series::phase(&call_otm, &now), PHASE_NO_EXERCISE_EXPIRY);
    assert_eq!(series::phase(&put_atm, &now), PHASE_NO_EXERCISE_EXPIRY);
    assert_eq!(series::phase(&put_otm, &now), PHASE_NO_EXERCISE_EXPIRY);

    now.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(call_atm);
    test_scenario::return_shared(call_otm);
    test_scenario::return_shared(put_atm);
    test_scenario::return_shared(put_otm);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExpiryPrice, location = series)]
fun zero_expiry_price_aborts() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
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
    let series_id = series::create_series<QUOTE, BASE>(
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
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
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
    let series_id = series::create_series<QUOTE, BASE>(
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
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EExpiryPriceMismatch, location = series)]
fun oracle_name_mismatch_aborts() {
    let (mut scenario, market_id) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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
        "switchboard",
        b"feed-sui-usdc",
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"payload-hash",
    );
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EExpiryPriceAlreadyFinalized, location = series)]
fun finalized_price_is_immutable() {
    let (mut scenario, _) = create_market_fixture();

    scenario.next_tx(USER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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
    let first_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"first-payload-hash",
    );
    let second_price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 2,
        EXPIRY_MS,
        b"second-payload-hash",
    );
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, first_price, &expiry_clock);
    series::finalize_one(&market, &mut series, second_price, &expiry_clock);
    expiry_clock.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = pyth_oracle_unverifiable::EUnsupportedOracle, location = pyth_oracle_unverifiable)]
fun non_pyth_market_oracle_aborts_in_pyth_adapter() {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());

    scenario.next_tx(ADMIN);
    let mut cap = scenario.take_from_sender<AdminCap>();
    let market_id = market::create_market<QUOTE, BASE>(
        &mut cap,
        "SUI",
        "switchboard",
        b"feed-sui-usdc",
        6,
        9,
        100_000_000,
        500,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(USER);
    let mut market = scenario.take_shared_by_id<Market>(market_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
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
    let market = scenario.take_shared_by_id<Market>(market_id);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        b"payload-hash",
    );
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    scenario.end();
}
