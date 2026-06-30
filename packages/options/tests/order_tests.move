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

const ORDER_BYTES: vector<u8> = x"0c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000000c01018093dc1400000000005a62020000000000e40b54020000000700000000000000204e000000000000000000000000000000000000000000000000000000000000000000000000000ea0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da";
const SERIALIZED_SIGNATURE: vector<u8> = x"00853380b477f1f628983a4fcd1c7f76fc57b4a218d8e11cd3fcb01c6dcb9695ac58a564c96156a09d39e97e1261250393ffa55fec6803a93f00214b54395b7402ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const PUBLIC_KEY: vector<u8> = x"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNER: address = @0xa0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da;
const ADMIN: address = @0xA;
const SELLER: address = @0xB;
const NOW_MS: u64 = 10_000;
const EXPIRY_MS: u64 = NOW_MS + 8 * 60 * 60 * 1000 + 1;
const FEE_RECIPIENT: address = @0xD;
const SIGNED_CALL: vector<u8> = x"b7010c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000bd726ecf6f7036ee3557cd6c7b93a49b231070e8eecada9cfa157e40e3f02e5d301018093dc1400000000119bb7010000000000e40b54020000000700000000000000204e00000000000077520198ea52372717b1278701852c232e32d5cf6e202dde276ce97a265fbe6ea0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da6100328e39b1e41250c3df0c1ba1f66da862fe9a3d9a5252b1424dcf7be147c28da4454589a4d2893699dce351d72bf3126f026a4ddb874b7cd954f77f070a450400ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c20ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNED_PUT: vector<u8> = x"b7010c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000bd726ecf6f7036ee3557cd6c7b93a49b231070e8eecada9cfa157e40e3f02e5d302018093dc1400000000119bb7010000000000e40b54020000000700000000000000204e00000000000077520198ea52372717b1278701852c232e32d5cf6e202dde276ce97a265fbe6ea0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da6100cbb426f4e01b5d1d276fcaeada66210c032cdbf441ad87fdfd5a46e2736abfdcd986f34ea5bc53c1846df6306892f7fc7bf55d11908ac6c1b8f7f1958e374508ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c20ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNED_MISSING_CALL: vector<u8> = x"b7010c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000bd726ecf6f7036ee3557cd6c7b93a49b231070e8eecada9cfa157e40e3f02e5d301018093dc1400000000119bb7010000000000e40b54020000000700000000000000204e000000000000dba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97a0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da6100d8184f8bdebd76ef6e3c038b8447c3a1ecb30590abaf1e3a729dcb40910cd2579d98b71c9d5a607f381bb5d7540579c67f382c0040eb0e95f87dee869a69870fea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c20ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNED_MISSING_PUT: vector<u8> = x"b7010c6f74703a6f726465723a7631000000000000000000000000000000000000000000000000000000000000000bd726ecf6f7036ee3557cd6c7b93a49b231070e8eecada9cfa157e40e3f02e5d302018093dc1400000000119bb7010000000000e40b54020000000700000000000000204e000000000000dba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97a0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da61006f38f0c2b77457612aad092d941a5787642ac3ef3941fbbbc42fe7e8b4420c18d5120393868c02cf5283e23a35c8a7cb4a243790090ef1904b40e304e269c607ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c20ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";

fun clock_at(timestamp_ms: u64, ctx: &mut TxContext): clock::Clock {
    let mut now = clock::create_for_testing(ctx);
    now.set_for_testing(timestamp_ms);
    now
}

fun create_signed_fixture(option_type: u8): (test_scenario::Scenario, ID, ID, ID) {
    create_signed_fixture_with_strike(option_type, 350_000_000)
}

fun create_signed_fixture_with_strike(option_type: u8, strike_price: u64): (test_scenario::Scenario, ID, ID, ID) {
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
        strike_price,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    object::delete(object::new(scenario.ctx()));
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

fun create_missing_series_signed_fixture(option_type: u8): (test_scenario::Scenario, ID, ID, ID) {
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
    let market = scenario.take_shared_by_id<Market>(market_id);
    let series_id = market::derived_series_id(&market, option_type, 350_000_000, EXPIRY_MS);
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
    let collateral = coin::mint(&mut base_cap, 10_000_000_000, scenario.ctx());
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
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10_000_000_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 10_000_000_000);
    assert_eq!(series::collateral_base_balance(&series), 10_000_000_000);
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
    assert_eq!(long::quantity(&long), 10_000_000_000);
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
fun signed_call_can_initialize_underwrite_and_share_missing_series() {
    let (mut scenario, market_id, series_id, vault_id) =
        create_missing_series_signed_fixture(series::option_type_call());

    scenario.next_tx(SELLER);
    let mut base_cap = scenario.take_from_sender<TreasuryCap<BASE>>();
    let collateral = coin::mint(&mut base_cap, 10_000_000_000, scenario.ctx());
    scenario.return_to_sender(base_cap);
    let mut market = scenario.take_shared_by_id<Market>(market_id);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    assert_eq!(market::is_series_claimed(&market, series::option_type_call(), 350_000_000, EXPIRY_MS), false);
    let mut series = series::initialize_series<QUOTE, BASE>(
        &mut market,
        series::option_type_call(),
        350_000_000,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    assert_eq!(object::id(&series), series_id);
    assert_eq!(market::is_series_claimed(&market, series::option_type_call(), 350_000_000, EXPIRY_MS), true);
    underwriting::underwrite_call(
        &market,
        &mut series,
        &mut vault,
        collateral,
        SIGNED_MISSING_CALL,
        7,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    assert_eq!(buyer_vault::balance(&vault), 30);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10_000_000_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 10_000_000_000);
    assert_eq!(series::collateral_base_balance(&series), 10_000_000_000);
    now.destroy_for_testing();
    series::share_initialized(series);
    test_scenario::return_shared(market);
    test_scenario::return_shared(vault);

    scenario.next_tx(SIGNER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::series_id(&long), series_id);
    scenario.return_to_sender(long);
    scenario.next_tx(SELLER);
    let series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10_000_000_000);
    test_scenario::return_shared(series);
    let seller_premium = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(seller_premium.value(), 63);
    scenario.return_to_sender(seller_premium);
    scenario.next_tx(FEE_RECIPIENT);
    let fee = scenario.take_from_sender<Coin<QUOTE>>();
    assert_eq!(fee.value(), 7);
    scenario.return_to_sender(fee);
    scenario.end();
}

#[test, expected_failure(abort_code = underwriting::EInvalidOrder, location = underwriting)]
fun signed_call_rejects_live_series_with_different_strike() {
    let (mut scenario, market_id, series_id, vault_id) =
        create_signed_fixture_with_strike(series::option_type_call(), 350_000_001);

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
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    test_scenario::return_shared(vault);
    scenario.end();
}

#[test]
fun signed_put_fill_debits_vault_and_settles_atomically() {
    let (mut scenario, market_id, series_id, vault_id) = create_signed_fixture(series::option_type_put());

    scenario.next_tx(SELLER);
    let mut quote_cap = scenario.take_from_sender<TreasuryCap<QUOTE>>();
    let collateral = coin::mint(&mut quote_cap, 35_000_000, scenario.ctx());
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
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10_000_000_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 35_000_000);
    assert_eq!(series::collateral_quote_balance(&series), 35_000_000);
    now.destroy_for_testing();
    test_scenario::return_shared(market);
    test_scenario::return_shared(series);
    test_scenario::return_shared(vault);

    scenario.next_tx(SIGNER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::quantity(&long), 10_000_000_000);
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
fun signed_put_can_initialize_underwrite_and_share_missing_series() {
    let (mut scenario, market_id, series_id, vault_id) =
        create_missing_series_signed_fixture(series::option_type_put());

    scenario.next_tx(SELLER);
    let mut quote_cap = scenario.take_from_sender<TreasuryCap<QUOTE>>();
    let collateral = coin::mint(&mut quote_cap, 35_000_000, scenario.ctx());
    scenario.return_to_sender(quote_cap);
    let mut market = scenario.take_shared_by_id<Market>(market_id);
    let mut vault = scenario.take_shared_by_id<BuyerVault<QUOTE>>(vault_id);
    let now = clock_at(NOW_MS, scenario.ctx());
    assert_eq!(market::is_series_claimed(&market, series::option_type_put(), 350_000_000, EXPIRY_MS), false);
    let mut series = series::initialize_series<QUOTE, BASE>(
        &mut market,
        series::option_type_put(),
        350_000_000,
        EXPIRY_MS,
        &now,
        scenario.ctx(),
    );
    assert_eq!(object::id(&series), series_id);
    underwriting::underwrite_put(
        &market,
        &mut series,
        &mut vault,
        collateral,
        SIGNED_MISSING_PUT,
        7,
        FEE_RECIPIENT,
        &now,
        scenario.ctx(),
    );
    assert_eq!(buyer_vault::balance(&vault), 30);
    assert_eq!(series::seller_short_quantity(&series, SELLER), 10_000_000_000);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 35_000_000);
    assert_eq!(series::collateral_quote_balance(&series), 35_000_000);
    now.destroy_for_testing();
    series::share_initialized(series);
    test_scenario::return_shared(market);
    test_scenario::return_shared(vault);

    scenario.next_tx(SIGNER);
    let long = scenario.take_from_sender<Long<QUOTE, BASE>>();
    assert_eq!(long::series_id(&long), series_id);
    scenario.return_to_sender(long);
    scenario.next_tx(SELLER);
    let series = scenario.take_shared_by_id<Series<QUOTE, BASE>>(series_id);
    assert_eq!(series::seller_collateral_quantity(&series, SELLER), 35_000_000);
    test_scenario::return_shared(series);
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
    assert_eq!(underwriting::order_call_put_marker(&order), 1);
    assert_eq!(underwriting::order_side_marker(&order), 1);
    assert_eq!(underwriting::order_strike_price(&order), 350_000_000);
    assert_eq!(underwriting::order_expiry_ms(&order), 40_000_000);
    assert_eq!(underwriting::order_contracts_quantity(&order), 10_000_000_000);
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
