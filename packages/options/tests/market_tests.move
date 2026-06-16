#[test_only]
module options_trading_protocol::market_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use std::unit_test::{assert_eq};
use sui::test_scenario;

public struct QUOTE has drop {}
public struct BASE has drop {}
public struct OTHER has drop {}

const ADMIN: address = @0xA;
const USER: address = @0xB;

fun create_market_fixture(): test_scenario::Scenario {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    market::create_market<QUOTE, BASE>(
        &cap,
        b"SUI".to_string(),
        b"pyth".to_string(),
        b"feed-sui-usdc",
        6,
        9,
        100_000_000,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);
    scenario
}

#[test]
fun created_market_stores_identity_and_admin() {
    let mut scenario = create_market_fixture();

    scenario.next_tx(USER);
    let market = scenario.take_shared<Market>();

    assert_eq!(market::oracle_base(&market), b"SUI".to_string());
    assert_eq!(market::oracle(&market), b"pyth".to_string());
    assert_eq!(*market::oracle_feed_id(&market), b"feed-sui-usdc");
    assert_eq!(market::quote_decimals(&market), 6);
    assert_eq!(market::base_decimals(&market), 9);
    assert_eq!(market::strike_scale(&market), 100_000_000);
    assert_eq!(market::is_paused(&market), false);
    assert_eq!(market::supports_coin_types<QUOTE, BASE>(&market), true);
    assert_eq!(market::supports_coin_types<OTHER, BASE>(&market), false);

    test_scenario::return_shared(market);
    scenario.end();
}

#[test]
fun admin_can_pause_and_unpause_market() {
    let mut scenario = create_market_fixture();

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let mut market = scenario.take_shared<Market>();

    market::pause(&mut market, &cap, scenario.ctx());
    assert_eq!(market::is_paused(&market), true);

    market::unpause(&mut market, &cap, scenario.ctx());
    assert_eq!(market::is_paused(&market), false);
    market::assert_not_paused(&market);

    test_scenario::return_shared(market);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = market::EPaused, location = market)]
fun paused_market_aborts_guarded_operations() {
    let mut scenario = create_market_fixture();

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let mut market = scenario.take_shared<Market>();
    market::pause(&mut market, &cap, scenario.ctx());
    market::assert_not_paused(&market);

    test_scenario::return_shared(market);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = market::EUnsupportedCoinTypes, location = market)]
fun unsupported_coin_types_abort() {
    let mut scenario = create_market_fixture();

    scenario.next_tx(USER);
    let market = scenario.take_shared<Market>();
    market::assert_supported_coin_types<OTHER, BASE>(&market);

    test_scenario::return_shared(market);
    scenario.end();
}

#[test, expected_failure(abort_code = market::ENotAdmin, location = market)]
fun non_admin_cap_cannot_pause_market() {
    let mut scenario = create_market_fixture();

    scenario.next_tx(USER);
    market::init_for_testing(scenario.ctx());

    scenario.next_tx(USER);
    let user_cap = scenario.take_from_sender<AdminCap>();
    let mut market = scenario.take_shared<Market>();
    market::pause(&mut market, &user_cap, scenario.ctx());

    test_scenario::return_shared(market);
    scenario.return_to_sender(user_cap);
    scenario.end();
}
