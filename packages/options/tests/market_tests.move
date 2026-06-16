#[test_only]
module options_trading_protocol::market_tests;

use options_trading_protocol::market::{Self, AdminCap, Market};
use std::unit_test::{assert_eq};
use sui::test_scenario;

public struct QUOTE has drop {}
public struct BASE has drop {}
public struct OTHER has drop {}
public struct BTC has drop {}
public struct USDC has drop {}
public struct WBTC has drop {}
public struct HBTC has drop {}

const ADMIN: address = @0xA;
const USER: address = @0xB;

fun create_market_fixture<QuoteCoin, BaseCoin>(
    oracle_base: std::string::String,
    oracle: std::string::String,
    oracle_feed_id: vector<u8>,
    quote_decimals: u8,
    base_decimals: u8,
    strike_scale: u64,
): (test_scenario::Scenario, ID) {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let market_id = market::create_market<QuoteCoin, BaseCoin>(
        &cap,
        oracle_base,
        oracle,
        oracle_feed_id,
        quote_decimals,
        base_decimals,
        strike_scale,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);
    (scenario, market_id)
}

fun default_market_fixture(): test_scenario::Scenario {
    let (scenario, _) = create_market_fixture<QUOTE, BASE>(
        "SUI",
        "pyth",
        b"feed-sui-usdc",
        6,
        9,
        100_000_000,
    );
    scenario
}

#[test]
fun created_market_stores_identity_and_admin() {
    let mut scenario = default_market_fixture();

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
    let mut scenario = default_market_fixture();

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
    let mut scenario = default_market_fixture();

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
    let mut scenario = default_market_fixture();

    scenario.next_tx(USER);
    let market = scenario.take_shared<Market>();
    market::assert_supported_coin_types<OTHER, BASE>(&market);

    test_scenario::return_shared(market);
    scenario.end();
}

#[test, expected_failure(abort_code = market::ENotAdmin, location = market)]
fun non_admin_cap_cannot_pause_market() {
    let mut scenario = default_market_fixture();

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

#[test]
fun multiple_markets_can_be_created_for_same_pair_with_different_collateral() {
    let (mut scenario, wbtc_market_id) = create_market_fixture<USDC, WBTC>(
        "BTC",
        "pyth",
        b"feed-btc-usdc-wbtc",
        6,
        8,
        100_000_000,
    );

    scenario.next_tx(ADMIN);
    let cap = scenario.take_from_sender<AdminCap>();
    let hbtc_market_id = market::create_market<USDC, HBTC>(
        &cap,
        "BTC",
        "pyth",
        b"feed-btc-usdc-hbtc",
        6,
        8,
        100_000_000,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(USER);
    let wbtc_market = scenario.take_shared_by_id<Market>(wbtc_market_id);
    let hbtc_market = scenario.take_shared_by_id<Market>(hbtc_market_id);

    assert_eq!(market::oracle_base(&wbtc_market), "BTC");
    assert_eq!(market::oracle_base(&hbtc_market), "BTC");
    assert_eq!(market::supports_coin_types<USDC, WBTC>(&wbtc_market), true);
    assert_eq!(market::supports_coin_types<USDC, HBTC>(&hbtc_market), true);
    assert_eq!(market::supports_coin_types<USDC, HBTC>(&wbtc_market), false);
    assert_eq!(market::supports_coin_types<USDC, WBTC>(&hbtc_market), false);

    test_scenario::return_shared(wbtc_market);
    test_scenario::return_shared(hbtc_market);
    scenario.end();
}
