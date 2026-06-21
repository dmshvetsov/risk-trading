#[test_only]
module test_usdc::test_usdc_tests;

use std::unit_test::assert_eq;
use sui::coin::TreasuryCap;
use sui::test_scenario;
use test_usdc::test_usdc::{Self, TEST_USDC};

const OWNER: address = @0xA;

#[test]
fun mint_and_burn() {
    let mut scenario = test_scenario::begin(OWNER);
    test_usdc::init_for_testing(scenario.ctx());

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_from_sender<TreasuryCap<TEST_USDC>>();
    let minted = test_usdc::mint(&mut cap, 1_500_000, scenario.ctx());

    assert_eq!(minted.value(), 1_500_000);
    assert_eq!(test_usdc::total_supply(&cap), 1_500_000);

    let burned = test_usdc::burn(&mut cap, minted);
    assert_eq!(burned, 1_500_000);
    assert_eq!(test_usdc::total_supply(&cap), 0);

    scenario.return_to_sender(cap);
    scenario.end();
}
