#[test_only]
module options_trading_protocol::underwriting_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::base::{Self, BASE};
use options_trading_protocol::long::{Self, Long};
use options_trading_protocol::quote::{Self, QUOTE};
use options_trading_protocol::series::{Self, CollateralPool, Series};
use options_trading_protocol::underwriting;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::test_scenario;

const ADMIN: address = @0xA;
const SELLER: address = @0xB;
const BUYER: address = @0xC;
const FEE_RECIPIENT: address = @0xD;
const NOW_MS: u64 = 10_000;
const MIN_UNDERWRITING_TIME_TO_EXPIRY_MS: u64 = 8 * 60 * 60 * 1000;
const EXPIRY_MS: u64 = NOW_MS + MIN_UNDERWRITING_TIME_TO_EXPIRY_MS + 1;
const STRIKE_PRICE: u64 = 350_000_000;
const OPTION_TYPE_CALL: u8 = 0;
const OPTION_TYPE_PUT: u8 = 1;

fun create_fixture(option_type: u8): (test_scenario::Scenario, ID, ID, ID) {
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
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(BUYER);
    let mut market = scenario.take_shared<Market>();
    let now = clock_at(NOW_MS, scenario.ctx());
    let (series_id, pool_id) = series::create_series<QUOTE, BASE>(
        &mut market,
        option_type,
        STRIKE_PRICE,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);

    (scenario, market_id, series_id, pool_id)
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

#[test]
fun seller_underwrites_call_and_buyer_receives_transferable_long() {
    let (mut scenario, market_id, series_id, pool_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 1_000_000_000);
    let premium = mint_quote(&mut scenario, 11_000);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral,
        premium,
        1_000_000_000,
        1_000,
        option::some(1_000),
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
    assert_eq!(series::accounted_base_balance(&pool), 1_000_000_000);
    assert_eq!(series::accounted_quote_balance(&pool), 0);

    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);
    test_scenario::return_shared(pool);

    scenario.next_tx(BUYER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::quantity(&long), 1_000_000_000);
    scenario.return_to_sender(long);
    scenario.end();
}

#[test]
fun put_underwriting_rounds_quote_collateral_up_for_solvency() {
    let (mut scenario, _, series_id, pool_id) = create_fixture(OPTION_TYPE_PUT);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut quote_payment = mint_quote(&mut scenario, 29);
    let premium = quote_payment.split(25, scenario.ctx());
    let collateral = quote_payment;
    let (long, seller_premium, fee) = underwriting::underwrite_put<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral,
        premium,
        1_000,
        5,
        option::some(5),
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();

    assert_eq!(underwriting::strike_payment(&series, 1_000), 4);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 1_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 4);
    assert_eq!(series::accounted_quote_balance(&pool), 4);
    assert_eq!(long::quantity(&long), 1_000);
    assert_eq!(seller_premium.value(), 20);
    assert_eq!(fee.value(), 5);

    transfer::public_transfer(long, BUYER);
    transfer::public_transfer(seller_premium, SELLER);
    transfer::public_transfer(fee, FEE_RECIPIENT);
    test_scenario::return_shared(series);
    test_scenario::return_shared(pool);
    scenario.end();
}

#[test]
fun seller_vault_aggregates_multiple_writes_for_same_series() {
    let (mut scenario, _, series_id, pool_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let mut premiums = mint_quote(&mut scenario, 2);
    let premium_a = premiums.split(1, scenario.ctx());
    let premium_b = premiums;
    let mut collateral = mint_base(&mut scenario, 25);
    let collateral_a = collateral.split(10, scenario.ctx());
    let collateral_b = collateral;
    let (long_a, seller_premium_a, fee_a) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral_a,
        premium_a,
        10,
        0,
        option::none(),
        BUYER,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    let (long_b, seller_premium_b, fee_b) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral_b,
        premium_b,
        15,
        0,
        option::none(),
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
    assert_eq!(series::accounted_base_balance(&pool), 25);

    transfer::public_transfer(long_a, BUYER);
    transfer::public_transfer(long_b, BUYER);
    transfer::public_transfer(seller_premium_a, SELLER);
    transfer::public_transfer(seller_premium_b, SELLER);
    fee_a.destroy_zero();
    fee_b.destroy_zero();
    test_scenario::return_shared(series);
    test_scenario::return_shared(pool);
    scenario.end();
}

#[test]
fun long_tokens_split_and_join_when_class_is_identical() {
    let (mut scenario, _, series_id, pool_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 100);
    let premium = mint_quote(&mut scenario, 1);
    let (mut long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral,
        premium,
        100,
        0,
        option::none(),
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
    test_scenario::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = underwriting::EFeeExceedsPremium, location = underwriting)]
fun fee_cannot_exceed_premium() {
    let (mut scenario, _, series_id, pool_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 10);
    let premium = mint_quote(&mut scenario, 1);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral,
        premium,
        10,
        2,
        option::none(),
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
    test_scenario::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = underwriting::EInsufficientCollateral, location = underwriting)]
fun call_collateral_must_equal_quantity() {
    let (mut scenario, _, series_id, pool_id) = create_fixture(OPTION_TYPE_CALL);

    scenario.next_tx(SELLER);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut pool = scenario.take_shared_by_id<CollateralPool<QUOTE, BASE>>(pool_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let collateral = mint_base(&mut scenario, 9);
    let premium = mint_quote(&mut scenario, 1);
    let (long, seller_premium, fee) = underwriting::underwrite_call<QUOTE, BASE>(
        &mut series,
        &mut pool,
        collateral,
        premium,
        10,
        0,
        option::none(),
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
    test_scenario::return_shared(pool);
    scenario.end();
}
