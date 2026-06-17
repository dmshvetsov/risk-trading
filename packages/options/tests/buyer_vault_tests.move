#[test_only]
module options_trading_protocol::buyer_vault_tests;

use options_trading_protocol::buyer_vault::{Self, BuyerVault};
use options_trading_protocol::quote::{Self, QUOTE};
use std::type_name;
use std::unit_test::assert_eq;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::event;
use sui::test_scenario;

const OWNER: address = @0xA;
const OTHER: address = @0xB;

fun begin_with_quote_cap(): test_scenario::Scenario {
    let mut scenario = test_scenario::begin(OWNER);
    let (cap, metadata) = quote::create(scenario.ctx());
    transfer::public_freeze_object(metadata);
    transfer::public_transfer(cap, OWNER);
    scenario
}

fun mint_quote(scenario: &mut test_scenario::Scenario, amount: u64): Coin<QUOTE> {
    let mut cap = scenario.take_from_sender<TreasuryCap<QUOTE>>();
    let coin = coin::mint(&mut cap, amount, scenario.ctx());
    scenario.return_to_sender(cap);
    coin
}

#[test]
fun owner_can_create_deposit_and_withdraw() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    let created = event::events_by_type<buyer_vault::BuyerVaultCreated>();
    assert_eq!(created.length(), 1);
    assert_eq!(buyer_vault::created_vault_id(&created[0]), vault_id);
    assert_eq!(buyer_vault::created_owner(&created[0]), OWNER);
    assert_eq!(buyer_vault::created_quote_coin_type(&created[0]), type_name::with_original_ids<QUOTE>());

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    buyer_vault::deposit(&mut vault, mint_quote(&mut scenario, 100), scenario.ctx());
    assert_eq!(buyer_vault::owner(&vault), OWNER);
    assert_eq!(buyer_vault::balance(&vault), 100);

    let withdrawn = buyer_vault::withdraw(&mut vault, 40, scenario.ctx());
    assert_eq!(withdrawn.value(), 40);
    assert_eq!(buyer_vault::balance(&vault), 60);

    let deposited = event::events_by_type<buyer_vault::BuyerVaultDeposited>();
    assert_eq!(deposited.length(), 1);
    assert_eq!(buyer_vault::deposited_vault_id(&deposited[0]), vault_id);
    assert_eq!(buyer_vault::deposited_owner(&deposited[0]), OWNER);
    assert_eq!(buyer_vault::deposited_quote_coin_type(&deposited[0]), type_name::with_original_ids<QUOTE>());
    assert_eq!(buyer_vault::deposited_amount(&deposited[0]), 100);

    let withdrawals = event::events_by_type<buyer_vault::BuyerVaultWithdrawn>();
    assert_eq!(withdrawals.length(), 1);
    assert_eq!(buyer_vault::withdrawn_vault_id(&withdrawals[0]), vault_id);
    assert_eq!(buyer_vault::withdrawn_owner(&withdrawals[0]), OWNER);
    assert_eq!(buyer_vault::withdrawn_quote_coin_type(&withdrawals[0]), type_name::with_original_ids<QUOTE>());
    assert_eq!(buyer_vault::withdrawn_amount(&withdrawals[0]), 40);

    test_scenario::return_shared(vault);
    transfer::public_transfer(withdrawn, OWNER);
    scenario.end();
}

#[test]
fun owner_can_create_multiple_independent_vaults() {
    let mut scenario = begin_with_quote_cap();
    let first_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());
    let second_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());
    assert!(first_id != second_id);

    scenario.next_tx(OWNER);
    let mut first = scenario.take_shared_by_id<BuyerVault<QUOTE>>(first_id);
    let second = scenario.take_shared_by_id<BuyerVault<QUOTE>>(second_id);
    buyer_vault::deposit(&mut first, mint_quote(&mut scenario, 25), scenario.ctx());
    assert_eq!(buyer_vault::balance(&first), 25);
    assert_eq!(buyer_vault::balance(&second), 0);

    test_scenario::return_shared(first);
    test_scenario::return_shared(second);
    scenario.end();
}

#[test]
fun owner_can_close_funded_vault() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    buyer_vault::deposit(&mut vault, mint_quote(&mut scenario, 75), scenario.ctx());
    let withdrawn = buyer_vault::close_vault(vault, scenario.ctx());
    assert_eq!(withdrawn.value(), 75);

    let closed = event::events_by_type<buyer_vault::BuyerVaultClosed>();
    assert_eq!(closed.length(), 1);
    assert_eq!(buyer_vault::closed_vault_id(&closed[0]), vault_id);
    assert_eq!(buyer_vault::closed_owner(&closed[0]), OWNER);
    assert_eq!(buyer_vault::closed_quote_coin_type(&closed[0]), type_name::with_original_ids<QUOTE>());
    assert_eq!(buyer_vault::closed_last_withdrawal_amount(&closed[0]), 75);

    transfer::public_transfer(withdrawn, OWNER);
    scenario.next_tx(OWNER);
    assert!(!test_scenario::has_most_recent_shared<BuyerVault<QUOTE>>());
    scenario.end();
}

#[test]
fun owner_can_close_empty_vault() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(OWNER);
    let vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let withdrawn = buyer_vault::close_vault(vault, scenario.ctx());
    assert_eq!(withdrawn.value(), 0);

    let closed = event::events_by_type<buyer_vault::BuyerVaultClosed>();
    assert_eq!(closed.length(), 1);
    assert_eq!(buyer_vault::closed_last_withdrawal_amount(&closed[0]), 0);

    transfer::public_transfer(withdrawn, OWNER);
    scenario.end();
}

#[test, expected_failure(abort_code = buyer_vault::ENotOwner, location = buyer_vault)]
fun non_owner_cannot_close_vault() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(OTHER);
    let vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let withdrawn = buyer_vault::close_vault(vault, scenario.ctx());
    transfer::public_transfer(withdrawn, OTHER);
    scenario.end();
}

#[test, expected_failure(abort_code = buyer_vault::ENotOwner, location = buyer_vault)]
fun non_owner_cannot_deposit() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(OWNER);
    let payment = mint_quote(&mut scenario, 10);
    transfer::public_transfer(payment, OTHER);

    scenario.next_tx(OTHER);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let payment = scenario.take_from_sender<Coin<QUOTE>>();
    buyer_vault::deposit(&mut vault, payment, scenario.ctx());
    test_scenario::return_shared(vault);
    scenario.end();
}

#[test, expected_failure(abort_code = buyer_vault::ENotOwner, location = buyer_vault)]
fun non_owner_cannot_withdraw() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(OTHER);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let withdrawn = buyer_vault::withdraw(&mut vault, 0, scenario.ctx());
    test_scenario::return_shared(vault);
    transfer::public_transfer(withdrawn, OTHER);
    scenario.end();
}

#[test, expected_failure(abort_code = buyer_vault::EInsufficientBalance, location = buyer_vault)]
fun withdrawal_above_available_balance_aborts() {
    let mut scenario = begin_with_quote_cap();
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    buyer_vault::deposit(&mut vault, mint_quote(&mut scenario, 10), scenario.ctx());
    let withdrawn = buyer_vault::withdraw(&mut vault, 11, scenario.ctx());
    test_scenario::return_shared(vault);
    transfer::public_transfer(withdrawn, OWNER);
    scenario.end();
}
