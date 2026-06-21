#[test_only]
module test_btc::test_btc_tests;

use std::unit_test::assert_eq;
use sui::coin::TreasuryCap;
use sui::test_scenario;
use test_btc::test_btc::{Self, TEST_BTC};

const OWNER: address = @0xA;

#[test]
fun mint_and_burn() {
    let mut scenario = test_scenario::begin(OWNER);
    test_btc::init_for_testing(scenario.ctx());

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_from_sender<TreasuryCap<TEST_BTC>>();
    let minted = test_btc::mint(&mut cap, 150_000_000, scenario.ctx());

    assert_eq!(minted.value(), 150_000_000);
    assert_eq!(test_btc::total_supply(&cap), 150_000_000);

    let burned = test_btc::burn(&mut cap, minted);
    assert_eq!(burned, 150_000_000);
    assert_eq!(test_btc::total_supply(&cap), 0);

    scenario.return_to_sender(cap);
    scenario.end();
}
