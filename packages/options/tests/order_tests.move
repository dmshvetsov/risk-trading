#[test_only]
module options_trading_protocol::order_tests;

use options_trading_protocol::buyer_vault::{Self, BuyerVault};
use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::base::{Self, BASE};
use options_trading_protocol::long::{Self, Long};
use options_trading_protocol::quote::{Self, QUOTE};
use options_trading_protocol::series::{Self, Series};
use options_trading_protocol::underwriting;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::event;
use sui::test_scenario;

const ORDER_BYTES: vector<u8> = x"0c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000d01018093dc1400000000005a6202000000000a000000000000000700000000000000204e000000000000000000000000000000000000000000000000000000000000000000000000000ea0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da";
const SERIALIZED_SIGNATURE: vector<u8> = x"00c89ef529fcdbd7daa791d29ce97e8348c99562fc8fab939d15c6a0d49a3788b91468d936d067164a274667c71bb249df20c1ab773d38edeb2bd0f801f4fce608ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const PUBLIC_KEY: vector<u8> = x"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNER: address = @0xa0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da;
const ADMIN: address = @0xA;
const SELLER: address = @0xB;
const NOW_MS: u64 = 10_000;
const EXPIRY_MS: u64 = NOW_MS + 8 * 60 * 60 * 1000 + 1;
const FEE_RECIPIENT: address = @0xD;
const SIGNED_CALL: vector<u8> = x"d7010c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000bd726ecf6f7036ee3557cd6c7b93a49b231070e8eecada9cfa157e40e3f02e5d301c5e4703d8ab941c77c53ac590c7764b9e6f197cd1bb6692613a1d3df9a256401018093dc1400000000119bb701000000000a000000000000000700000000000000204e00000000000077520198ea52372717b1278701852c232e32d5cf6e202dde276ce97a265fbe6ea0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da61007dab056d1591f8718a14394ebba70774e4e9ad9fe5194a7467d94d2350a37624f9c68185e85394cf2ded7a3d2c66473ff01465b72fb0416d551952d0cf1ba80dea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c20ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNED_PUT: vector<u8> = x"d7010c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000bd726ecf6f7036ee3557cd6c7b93a49b231070e8eecada9cfa157e40e3f02e5d301c5e4703d8ab941c77c53ac590c7764b9e6f197cd1bb6692613a1d3df9a256402018093dc1400000000119bb701000000000a000000000000000700000000000000204e00000000000077520198ea52372717b1278701852c232e32d5cf6e202dde276ce97a265fbe6ea0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da61007ab48c91c017fe0955151c6f6914606d2538c612c7061798c0be911db6325e0367045442652d458a38347c0466b345d2b653e71fef4452dcd683d3772e9ff20dea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c20ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";

fun clock_at(timestamp_ms: u64, ctx: &mut TxContext): clock::Clock {
    let mut now = clock::create_for_testing(ctx);
    now.set_for_testing(timestamp_ms);
    now
}

fun create_signed_fixture(option_type: u8): (test_scenario::Scenario, ID, ID, ID) {
    let mut scenario = test_scenario::begin(ADMIN);
    market::init_for_testing(scenario.ctx());
    let (quote_cap, quote_metadata) = quote::create(scenario.ctx());
    let (base_cap, base_metadata) = base::create(scenario.ctx());
    transfer::public_freeze_object(quote_metadata);
    transfer::public_freeze_object(base_metadata);
    transfer::public_transfer(quote_cap, SELLER);
    transfer::public_transfer(base_cap, SELLER);

    scenario.next_tx(ADMIN);
    let mut admin_cap = scenario.take_from_sender<AdminCap>();
    let market_id = market::create_market<QUOTE, BASE>(
        &mut admin_cap,
        "SUI",
        "pyth",
        b"feed-sui-usdc",
        6,
        9,
        100_000_000,
        10_000,
        scenario.ctx(),
    );
    scenario.return_to_sender(admin_cap);

    scenario.next_tx(SIGNER);
    let mut market = scenario.take_shared_by_id<Market>(market_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    let series_id = series::create_series<QUOTE, BASE>(
        &mut market,
        option_type,
        350_000_000,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    let vault_id = buyer_vault::create_vault<QUOTE>(scenario.ctx());

    scenario.next_tx(SELLER);
    let mut quote_cap = scenario.take_from_sender<TreasuryCap<QUOTE>>();
    let premium = coin::mint(&mut quote_cap, 100, scenario.ctx());
    scenario.return_to_sender(quote_cap);
    transfer::public_transfer(premium, SIGNER);

    scenario.next_tx(SIGNER);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let premium = scenario.take_from_sender<Coin<QUOTE>>();
    buyer_vault::deposit(&mut vault, premium, scenario.ctx());
    test_scenario::return_shared(vault);

    (scenario, market_id, series_id, vault_id)
}

#[test]
fun signed_call_fill_debits_vault_and_settles_atomically() {
    let (mut scenario, market_id, series_id, vault_id) = create_signed_fixture(series::option_type_call());

    scenario.next_tx(SELLER);
    let mut base_cap = scenario.take_from_sender<TreasuryCap<BASE>>();
    let collateral = coin::mint(&mut base_cap, 10, scenario.ctx());
    scenario.return_to_sender(base_cap);
    let market = scenario.take_shared_by_id<Market>(market_id);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    underwriting::underwrite_call(
        &market,
        &mut series,
        &mut vault,
        collateral,
        SIGNED_CALL,
        7,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    assert_eq!(buyer_vault::balance(&vault), 30);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 10);
    assert_eq!(series::collateral_base_balance(&series), 10);
    let events = event::events_by_type<underwriting::Underwritten>();
    assert_eq!(events.length(), 1);
    assert_eq!(underwriting::buyer(&events[0]), SIGNER);
    assert_eq!(underwriting::premium_total(&events[0]), 70);
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    test_scenario::return_shared(vault);

    scenario.next_tx(SIGNER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::quantity(&long), 10);
    scenario.return_to_sender(long);
    scenario.next_tx(SELLER);
    let seller_premium = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(seller_premium.value(), 63);
    scenario.return_to_sender(seller_premium);
    scenario.next_tx(FEE_RECIPIENT);
    let fee = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(fee.value(), 7);
    scenario.return_to_sender(fee);
    scenario.end();
}

#[test]
fun signed_put_fill_debits_vault_and_settles_atomically() {
    let (mut scenario, market_id, series_id, vault_id) = create_signed_fixture(series::option_type_put());

    scenario.next_tx(SELLER);
    let mut quote_cap = scenario.take_from_sender<TreasuryCap<QUOTE>>();
    let collateral = coin::mint(&mut quote_cap, 1, scenario.ctx());
    scenario.return_to_sender(quote_cap);
    let market = scenario.take_shared_by_id<Market>(market_id);
    let mut series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    underwriting::underwrite_put(
        &market,
        &mut series,
        &mut vault,
        collateral,
        SIGNED_PUT,
        7,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    assert_eq!(buyer_vault::balance(&vault), 30);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 1);
    assert_eq!(series::collateral_quote_balance(&series), 1);
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    test_scenario::return_shared(vault);

    scenario.next_tx(SIGNER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::quantity(&long), 10);
    scenario.return_to_sender(long);
    scenario.next_tx(SELLER);
    let seller_premium = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(seller_premium.value(), 63);
    scenario.return_to_sender(seller_premium);
    scenario.next_tx(FEE_RECIPIENT);
    let fee = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(fee.value(), 7);
    scenario.return_to_sender(fee);
    scenario.end();
}

#[test]
fun canonical_order_decodes_every_field() {
    let order = underwriting::decode_order(ORDER_BYTES);
    assert_eq!(underwriting::order_domain(&order), b"otp:order:v1");
    assert_eq!(underwriting::order_seller(&order), @0xB);
    assert_eq!(underwriting::order_market_id(&order), @0xC);
    assert_eq!(underwriting::order_series_id(&order), @0xD);
    assert_eq!(underwriting::order_call_put_marker(&order), 1);
    assert_eq!(underwriting::order_side_market(&order), 1);
    assert_eq!(underwriting::order_strike_price(&order), 350_000_000);
    assert_eq!(underwriting::order_expiry_ms(&order), 40_000_000);
    assert_eq!(underwriting::order_contracts_quantity(&order), 10);
    assert_eq!(underwriting::order_premium_per_contract(&order), 7);
    assert_eq!(underwriting::order_good_till_ms(&order), 20_000);
    assert_eq!(underwriting::order_buyer_vault_id(&order), @0xE);
    assert_eq!(underwriting::order_signer(&order), SIGNER);
}

#[test]
fun sui_personal_message_signature_is_valid() {
    let (order_bytes, signature, public_key) = (ORDER_BYTES, SERIALIZED_SIGNATURE, PUBLIC_KEY);
    let order = underwriting::decode_order(order_bytes);
    underwriting::verify_signed_order(&order, &order_bytes, &signature, &public_key);
}

#[test, expected_failure(abort_code = 7, location = underwriting)]
fun altered_order_rejects_signature() {
    let mut altered = ORDER_BYTES;
    *(&mut altered[100]) = altered[100] + 1;
    let order = underwriting::decode_order(altered);
    let (signature, public_key) = (SERIALIZED_SIGNATURE, PUBLIC_KEY);
    underwriting::verify_signed_order(&order, &altered, &signature, &public_key);
}
