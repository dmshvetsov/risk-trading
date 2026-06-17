#[test_only]
module options_trading_protocol::underwriting_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::base::{Self, BASE};
use options_trading_protocol::long::{Self, Long};
use options_trading_protocol::pyth_oracle_unverifiable;
use options_trading_protocol::quote::{Self, QUOTE};
use options_trading_protocol::series::{Self, Series};
use options_trading_protocol::underwriting;
use std::unit_test::assert_eq;
use sui::balance;
use sui::clock;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::test_scenario;

const ADMIN: address = @0xA;
const SELLER: address = @0xB;
const BUYER: address = @0xC;
const FEE_RECIPIENT: address = @0xD;
const USER: address = @0xE;
const SECOND_SELLER: address = @0xF;
const NOW_MS: u64 = 10_000;
const MIN_UNDERWRITING_TIME_TO_EXPIRY_MS: u64 = 8 * 60 * 60 * 1000;
const EXPIRY_MS: u64 = NOW_MS + MIN_UNDERWRITING_TIME_TO_EXPIRY_MS + 1;
const STRIKE_PRICE: u64 = 350_000_000;
const OPTION_TYPE_CALL: u8 = 0;
const OPTION_TYPE_PUT: u8 = 1;
const EXERCISE_WINDOW_MS: u64 = 60 * 60 * 1000;
const STATE_CLOSED: u8 = 2;

fun create_fixture(option_type: u8): (test_scenario::Scenario, ID, ID) {
    create_fixture_with_fee_bps(option_type, 10_000)
}

fun create_fixture_with_fee_bps(option_type: u8, max_operational_fee_bps: u64): (test_scenario::Scenario, ID, ID) {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());
    create_currency_caps(&mut scenario);

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
        max_operational_fee_bps,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(BUYER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        option_type,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    (scenario, market_id, series_id)
}

fun create_currency_caps(scenario: &mut test_scenario::Scenario) {
    let (quote_cap, quote_metadata) = quote::create(scenario.ctx());
    let (base_cap, base_metadata) = base::create(scenario.ctx());

    transfer::public_freeze_object(quote_metadata);
    transfer::public_freeze_object(base_metadata);
    transfer::public_transfer(quote_cap, SELLER);
    transfer::public_transfer(base_cap, SELLER);
}

fun mint_quote(scenario: &mut test_scenario::Scenario, amount: u64): Coin<QUOTE> {
    let mut cap = scenario.take_from_sender<TreasuryCap<QUOTE>>();
    let coin = coin::mint(&mut cap, amount, scenario.ctx());
    scenario.return_to_sender(cap);
    coin
}

fun mint_base(scenario: &mut test_scenario::Scenario, amount: u64): Coin<BASE> {
    let mut cap = scenario.take_from_sender<TreasuryCap<BASE>>();
    let coin = coin::mint(&mut cap, amount, scenario.ctx());
    scenario.return_to_sender(cap);
    coin
}

fun clock_at(timestamp_ms: u64, ctx: &mut TxContext): clock::Clock {
    let mut now = clock::create_for_testing(ctx);
    now.set_for_testing(timestamp_ms);
    now
}

fun finalize_series(
    scenario: &mut test_scenario::Scenario,
    market_id: ID,
    series_id: ID,
    expiry_price: u64,
) {
    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market = scenario.take_shared_by_id<Market>(market_id);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let price = pyth_oracle_unverifiable::create_expiry_price(
        &market,
        &cap,
        EXPIRY_MS,
        expiry_price,
        EXPIRY_MS,
        b"settlement-payload-hash",
    );
    let expiry_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::finalize_one(&market, &mut series, price, &expiry_clock);
    expiry_clock.destroy_for_testing();
    scenario.return_to_sender(cap);
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
}

#[test]
fun admin_creates_market_and_series_then_call_lifecycle_settles_itm() {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());
    create_currency_caps(&mut scenario);

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
        10_000,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(ADMIN);
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

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 1_000_000_000);
    let mut quote_payment = mint_quote(&mut scenario, 3_500_100);
    let premium = quote_payment.split(100, scenario.ctx());
    let exercise_payment = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        1_000_000_000,
        10,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();

    assert_eq!(seller_premium.value(), 90);
    assert_eq!(fee.value(), 10);
    assert_eq!(long::market_id(&long), market_id);
    assert_eq!(long::series_id(&long), series_id);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 1_000_000_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 1_000_000_000);
    assert_eq!(series::collateral_base_balance(&series), 1_000_000_000);
    assert_eq!(series::accounted_base_balance(&series), 1_000_000_000);
    assert_eq!(series::excess_base_balance(&series), 0);

    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(exercise_payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let base_payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();

    assert_eq!(base_payout.value(), 1_000_000_000);
    assert_eq!(series::total_manual_exercised_quantity(&series), 1_000_000_000);
    assert_eq!(series::total_manual_exercise_quote_proceeds(&series), 3_500_000);
    assert_eq!(series::collateral_base_balance(&series), 0);
    assert_eq!(series::collateral_quote_balance(&series), 3_500_000);
    assert_eq!(series::accounted_base_balance(&series), 0);
    assert_eq!(series::accounted_quote_balance(&series), 3_500_000);
    assert_eq!(series::excess_base_balance(&series), 0);
    assert_eq!(series::excess_quote_balance(&series), 0);

    transfer::public_transfer(base_payout, BUYER);
    test_scenario::return_shared(series);

    scenario.next_tx(ADMIN);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS + EXERCISE_WINDOW_MS + 1, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::seller_vault_count(&series), 0);
    assert_eq!(series::collateral_quote_balance(&series), 0);
    assert_eq!(series::accounted_quote_balance(&series), 0);
    assert_eq!(series::excess_quote_balance(&series), 0);

    test_scenario::return_shared(series);

    scenario.next_tx(SELLER);
    let quote_proceeds = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(quote_proceeds.value(), 3_500_000);
    transfer::public_transfer(quote_proceeds, SELLER);
    scenario.end();
}

#[test]
fun seller_underwrites_call_and_buyer_receives_transferable_long() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 1_000_000_000);
    let premium = mint_quote(&mut scenario, 11_000);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        1_000_000_000,
        1_000,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();

    assert_eq!(seller_premium.value(), 10_000);
    assert_eq!(fee.value(), 1_000);
    assert_eq!(long::market_id(&long), market_id);
    assert_eq!(long::series_id(&long), series_id);
    assert_eq!(long::quantity(&long), 1_000_000_000);
    assert_eq!(series::total_short_quantity(&series), 1_000_000_000);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 1_000_000_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 1_000_000_000);
    assert_eq!(series::accounted_base_balance(&series), 1_000_000_000);
    assert_eq!(series::accounted_quote_balance(&series), 0);

    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);

    scenario.next_tx(BUYER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::quantity(&long), 1_000_000_000);
    scenario.return_to_sender(long);
    scenario.end();
}

#[test]
fun put_underwriting_rounds_quote_collateral_up_for_solvency() {
    let (mut scenario, _, series_id) = create_fixture(OPTION_TYPE_PUT);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut quote_payment = mint_quote(&mut scenario, 29);
    let premium = quote_payment.split(25, scenario.ctx());
    let collateral = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_put<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        1_000,
        5,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();

    assert_eq!(underwriting::strike_payment(&series, 1_000), 4);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 1_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 4);
    assert_eq!(series::accounted_quote_balance(&series), 4);
    assert_eq!(long::quantity(&long), 1_000);
    assert_eq!(seller_premium.value(), 20);
    assert_eq!(fee.value(), 5);

    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun seller_vault_aggregates_multiple_writes_for_same_series() {
    let (mut scenario, _, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut premiums = mint_quote(&mut scenario, 2);
    let premium_a = premiums.split(1, scenario.ctx());
    let premium_b = premiums;
    let mut collateral = mint_base(&mut scenario, 25);
    let collateral_a = collateral.split(10, scenario.ctx());
    let collateral_b = collateral;
    let (long_a, seller_premium_a, fee_a) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral_a,
        premium_a,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    let (long_b, seller_premium_b, fee_b) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral_b,
        premium_b,
        15,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();

    assert_eq!(series::seller_vault_count(&series), 1);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 25);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 25);
    assert_eq!(series::total_short_quantity(&series), 25);
    assert_eq!(series::accounted_base_balance(&series), 25);

    transfer::public_transfer(long_a, BUYER);
    transfer::public_transfer(long_b, BUYER);
    transfer::public_transfer(seller_premium_a, SELLER);
    transfer::public_transfer(seller_premium_b, SELLER);
    fee_a.destroy_zero();
    fee_b.destroy_zero();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun long_tokens_split_and_join_when_class_is_identical() {
    let (mut scenario, _, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 100);
    let premium = mint_quote(&mut scenario, 1);
    let (mut long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        100,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    let child = long::split(&mut long, 40, scenario.ctx());
    long::join(&mut long, child);

    assert_eq!(long::quantity(&long), 100);

    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun call_holder_exercises_and_seller_receives_quote_proceeds() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 1_000_000_000);
    let mut quote_payment = mint_quote(&mut scenario, 3_500_001);
    let premium = quote_payment.split(1, scenario.ctx());
    let exercise_payment = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        1_000_000_000,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(exercise_payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let base_payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();

    assert_eq!(base_payout.value(), 1_000_000_000);
    assert_eq!(series::total_manual_exercised_quantity(&series), 1_000_000_000);
    assert_eq!(series::total_manual_exercise_quote_proceeds(&series), 3_500_000);
    assert_eq!(series::accounted_base_balance(&series), 0);
    assert_eq!(series::accounted_quote_balance(&series), 3_500_000);

    transfer::public_transfer(base_payout, BUYER);
    test_scenario::return_shared(series);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS + EXERCISE_WINDOW_MS + 1, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::seller_vault_count(&series), 0);
    assert_eq!(series::accounted_quote_balance(&series), 0);

    test_scenario::return_shared(series);

    scenario.next_tx(SELLER);
    let quote_proceeds = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(quote_proceeds.value(), 3_500_000);
    transfer::public_transfer(quote_proceeds, SELLER);
    scenario.end();
}

#[test]
fun put_holder_exercises_and_seller_receives_base_proceeds() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_PUT);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut quote_payment = mint_quote(&mut scenario, 3_500_001);
    let premium = quote_payment.split(1, scenario.ctx());
    let collateral = quote_payment;
    let exercise_payment = mint_base(&mut scenario, 1_000_000_000);
    let (long, seller_premium, fee) = underwriting::underwrite_put<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        1_000_000_000,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(exercise_payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE - 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<BASE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let quote_payout = series::exercise_put(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();

    assert_eq!(quote_payout.value(), 3_500_000);
    assert_eq!(series::total_manual_exercised_quantity(&series), 1_000_000_000);
    assert_eq!(series::total_manual_exercise_base_proceeds(&series), 1_000_000_000);
    assert_eq!(series::accounted_base_balance(&series), 1_000_000_000);
    assert_eq!(series::accounted_quote_balance(&series), 0);

    transfer::public_transfer(quote_payout, BUYER);
    test_scenario::return_shared(series);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS + EXERCISE_WINDOW_MS + 1, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::seller_vault_count(&series), 0);
    assert_eq!(series::accounted_base_balance(&series), 0);

    test_scenario::return_shared(series);

    scenario.next_tx(SELLER);
    let base_proceeds = scenario.take_from_sender<Coin<BASE>>();
    assert_eq!(base_proceeds.value(), 1_000_000_000);
    transfer::public_transfer(base_proceeds, SELLER);
    scenario.end();
}

#[test]
fun no_exercise_call_settlement_returns_original_collateral() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 42);
    let premium = mint_quote(&mut scenario, 1);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        42,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::accounted_base_balance(&series), 0);
    test_scenario::return_shared(series);

    scenario.next_tx(SELLER);
    let returned_collateral = scenario.take_from_sender<Coin<BASE>>();
    assert_eq!(returned_collateral.value(), 42);
    transfer::public_transfer(returned_collateral, SELLER);
    scenario.end();
}

#[test]
fun no_exercise_put_settlement_returns_original_quote_collateral() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_PUT);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut quote_payment = mint_quote(&mut scenario, 3_500_001);
    let premium = quote_payment.split(1, scenario.ctx());
    let collateral = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_put<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        1_000_000_000,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::accounted_quote_balance(&series), 0);
    test_scenario::return_shared(series);

    scenario.next_tx(SELLER);
    let returned_collateral = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(returned_collateral.value(), 3_500_000);
    transfer::public_transfer(returned_collateral, SELLER);
    scenario.end();
}

#[test]
fun call_settlement_allocates_manual_exercise_proceeds_pro_rata() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut collateral = mint_base(&mut scenario, 1_000_000_000);
    let collateral_a = collateral.split(400_000_000, scenario.ctx());
    let collateral_b = collateral;
    let mut quote_payment = mint_quote(&mut scenario, 3_500_001);
    let premium_a = quote_payment.split(1, scenario.ctx());
    let exercise_payment = quote_payment;
    let (long_a, seller_premium_a, fee_a) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral_a,
        premium_a,
        400_000_000,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    transfer::public_transfer(collateral_b, SECOND_SELLER);
    transfer::public_transfer(long_a, BUYER);
    transfer::public_transfer(exercise_payment, BUYER);
    transfer::public_transfer(seller_premium_a, SELLER);
    fee_a.destroy_zero();
    test_scenario::return_shared(series);

    scenario.next_tx(SECOND_SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let collateral_b = scenario.take_from_sender<Coin<BASE>>();
    let premium_b = coin::zero<QUOTE>(scenario.ctx());
    let (long_b, seller_premium_b, fee_b) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral_b,
        premium_b,
        600_000_000,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long_b, BUYER);
    seller_premium_b.destroy_zero();
    fee_b.destroy_zero();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let long_b = scenario.take_from_sender<Long<QUOTE, BASE>>();
    long::join(&mut long, long_b);
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let base_payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();
    transfer::public_transfer(base_payout, BUYER);
    test_scenario::return_shared(series);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS + EXERCISE_WINDOW_MS + 1, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER, SECOND_SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::accounted_quote_balance(&series), 0);
    test_scenario::return_shared(series);

    scenario.next_tx(SELLER);
    let seller_quote = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(seller_quote.value(), 1_400_000);
    transfer::public_transfer(seller_quote, SELLER);

    scenario.next_tx(SECOND_SELLER);
    let second_seller_quote = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(second_seller_quote.value(), 2_100_000);
    transfer::public_transfer(second_seller_quote, SECOND_SELLER);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExercisePhase, location = series)]
fun exercise_before_price_finalization_aborts() {
    let (mut scenario, _, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let mut quote_payment = mint_quote(&mut scenario, 2);
    let premium = quote_payment.split(1, scenario.ctx());
    let payment = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    let payout = series::exercise_call(&mut series, long, payment, &now, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    now.destroy_for_testing();
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExercisePhase, location = series)]
fun exercise_after_exercise_window_aborts() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let mut quote_payment = mint_quote(&mut scenario, 36);
    let premium = quote_payment.split(1, scenario.ctx());
    let payment = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    now.destroy_for_testing();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let late_clock = clock_at(EXPIRY_MS + EXERCISE_WINDOW_MS + 1, scenario.ctx());
    let payout = series::exercise_call(&mut series, long, payment, &late_clock, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    late_clock.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExercisePayment, location = series)]
fun exercise_with_wrong_payment_amount_aborts() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let mut quote_payment = mint_quote(&mut scenario, 35);
    let premium = quote_payment.split(1, scenario.ctx());
    let payment = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    now.destroy_for_testing();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();
    transfer::public_transfer(payout, BUYER);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExerciseQuantity, location = series)]
fun zero_quantity_long_exercise_aborts() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let mut quote_payment = mint_quote(&mut scenario, 36);
    let premium = quote_payment.split(1, scenario.ctx());
    let payment = quote_payment;
    let (mut long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    let zero_long = long::split(&mut long, 0, scenario.ctx());
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(zero_long, BUYER);
    transfer::public_transfer(payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    now.destroy_for_testing();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let zero_long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_call(&mut series, zero_long, payment, &exercise_clock, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    exercise_clock.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExercisePhase, location = series)]
fun atm_call_exercise_aborts() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let mut quote_payment = mint_quote(&mut scenario, 2);
    let premium = quote_payment.split(1, scenario.ctx());
    let payment = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    now.destroy_for_testing();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    exercise_clock.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInvalidExercisePhase, location = series)]
fun otm_put_exercise_aborts() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_PUT);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut quote_payment = mint_quote(&mut scenario, 2);
    let premium = quote_payment.split(1, scenario.ctx());
    let collateral = quote_payment;
    let payment = mint_base(&mut scenario, 10);
    let (long, seller_premium, fee) = underwriting::underwrite_put<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(payment, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    fee.destroy_zero();
    now.destroy_for_testing();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<BASE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_put(&mut series, long, payment, &exercise_clock, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    exercise_clock.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::ELongMismatch, location = series)]
fun exercise_with_long_from_another_series_aborts() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(BUYER);
    let mut market = scenario.take_shared_by_id<Market>(market_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let other_series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        OPTION_TYPE_CALL,
        STRIKE_PRICE + 1,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut other_series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(other_series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let payment = mint_quote(&mut scenario, 1);
    let premium = coin::zero<QUOTE>(scenario.ctx());
    let (wrong_long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut other_series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    series::record_call_underwriting(&mut series, SELLER, 10, balance::zero());
    transfer::public_transfer(wrong_long, BUYER);
    transfer::public_transfer(payment, BUYER);
    seller_premium.destroy_zero();
    fee.destroy_zero();
    now.destroy_for_testing();
    test_scenario::return_shared(series);
    test_scenario::return_shared(other_series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 2);
    finalize_series(&mut scenario, market_id, other_series_id, STRIKE_PRICE + 2);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let wrong_long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_call(&mut series, wrong_long, payment, &exercise_clock, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    exercise_clock.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInsufficientCollateral, location = series)]
fun settlement_overdraw_aborts_before_pool_split() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    series::record_call_underwriting(&mut series, SELLER, 10, balance::zero());
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInsufficientCollateral, location = series)]
fun call_exercise_aborts_when_internal_custody_is_depleted() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    series::record_call_underwriting(&mut series, SELLER, 10, balance::zero());
    let long: Long<QUOTE, BASE> = long::mint(
        market_id,
        series_id,
        OPTION_TYPE_CALL,
        STRIKE_PRICE,
        EXPIRY_MS,
        10,
        scenario.ctx(),
    );
    let payment = mint_quote(&mut scenario, 1);
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(payment, BUYER);
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();
    transfer::public_transfer(payout, BUYER);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = series::EInsufficientCollateral, location = series)]
fun put_exercise_aborts_when_internal_custody_is_depleted() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_PUT);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    series::record_put_underwriting(&mut series, SELLER, 1_000_000_000, 3_500_000, balance::zero());
    let long: Long<QUOTE, BASE> = long::mint(
        market_id,
        series_id,
        OPTION_TYPE_PUT,
        STRIKE_PRICE,
        EXPIRY_MS,
        1_000_000_000,
        scenario.ctx(),
    );
    let payment = mint_base(&mut scenario, 1_000_000_000);
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(payment, BUYER);
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE - 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let payment = scenario.take_from_sender<Coin<BASE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_put(&mut series, long, payment, &exercise_clock, scenario.ctx());
    exercise_clock.destroy_for_testing();
    transfer::public_transfer(payout, BUYER);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test]
fun pro_rata_rounding_dust_remains_in_internal_custody() {
    let (mut scenario, market_id, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut collateral = mint_base(&mut scenario, 3);
    let exercise_payment = mint_quote(&mut scenario, 1);
    let first_collateral = collateral.split(1, scenario.ctx());
    let first_premium = coin::zero<QUOTE>(scenario.ctx());
    let (first_long, first_seller_premium, first_fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        first_collateral,
        first_premium,
        1,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    transfer::public_transfer(collateral, SECOND_SELLER);
    transfer::public_transfer(first_long, BUYER);
    transfer::public_transfer(exercise_payment, BUYER);
    first_seller_premium.destroy_zero();
    first_fee.destroy_zero();
    test_scenario::return_shared(series);

    scenario.next_tx(SECOND_SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let collateral = scenario.take_from_sender<Coin<BASE>>();
    let premium = coin::zero<QUOTE>(scenario.ctx());
    let (second_long, second_seller_premium, second_fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        2,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(second_long, BUYER);
    second_seller_premium.destroy_zero();
    second_fee.destroy_zero();
    test_scenario::return_shared(series);

    finalize_series(&mut scenario, market_id, series_id, STRIKE_PRICE + 1);

    scenario.next_tx(BUYER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    let second_long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    long::join(&mut long, second_long);
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    let exercise_clock = clock_at(EXPIRY_MS, scenario.ctx());
    let payout = series::exercise_call(&mut series, long, payment, &exercise_clock, scenario.ctx());
    transfer::public_transfer(payout, BUYER);
    exercise_clock.destroy_for_testing();
    test_scenario::return_shared(series);

    scenario.next_tx(USER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let settlement_clock = clock_at(EXPIRY_MS + EXERCISE_WINDOW_MS + 1, scenario.ctx());
    series::settle_sellers(&mut series, vector[SELLER, SECOND_SELLER], &settlement_clock, scenario.ctx());
    settlement_clock.destroy_for_testing();

    assert_eq!(series::state(&series), STATE_CLOSED);
    assert_eq!(series::collateral_quote_balance(&series), 1);
    assert_eq!(series::accounted_quote_balance(&series), 1);
    assert_eq!(series::excess_quote_balance(&series), 0);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = underwriting::EFeeExceedsPremium, location = underwriting)]
fun fee_cannot_exceed_premium() {
    let (mut scenario, _, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let premium = mint_quote(&mut scenario, 1);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        2,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = underwriting::EFeeExceedsMaximum, location = underwriting)]
fun fee_cannot_exceed_market_basis_points_cap() {
    let (mut scenario, _, series_id) = create_fixture_with_fee_bps(OPTION_TYPE_CALL, 500);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let premium = mint_quote(&mut scenario, 10_000);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        501,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);
    scenario.end();
}

#[test, expected_failure(abort_code = underwriting::EInsufficientCollateral, location = underwriting)]
fun call_collateral_must_equal_quantity() {
    let (mut scenario, _, series_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 9);
    let premium = mint_quote(&mut scenario, 1);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        collateral,
        premium,
        10,
        0,
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);
    scenario.end();
}
