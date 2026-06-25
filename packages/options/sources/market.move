module options_trading_protocol::market;

use std::string::String;
use std::type_name::{Self, TypeName};
use sui::derived_object;
use sui::dynamic_field;
use sui::event;

const ENotAdmin: u64 = 0;
const EUnsupportedCoinTypes: u64 = 1;
const EPaused: u64 = 2;
const EInvalidOperationalFeeBps: u64 = 3;
const EMarketAlreadyExists: u64 = 4;

const BPS_DENOMINATOR: u64 = 10_000;

public struct SeriesKey(u8, u64, u64) has copy, drop, store;

public struct AdminCap has key, store {
    id: UID,
}

public struct Market has key {
    id: UID,
    oracle_base: String,
    oracle: String,
    oracle_feed_id: vector<u8>,
    quote_decimals: u8,
    base_decimals: u8,
    strike_scale: u64,
    max_operational_fee_bps: u64,
    quote_coin_type: TypeName,
    base_coin_type: TypeName,
    admin_cap_id: ID,
    paused: bool,
}

public struct MarketCreated has copy, drop {
    market_id: ID,
    oracle_base: String,
    quote_coin_type: TypeName,
    base_coin_type: TypeName,
    oracle: String,
    oracle_feed_id: vector<u8>,
    max_operational_fee_bps: u64,
}

public struct Paused has copy, drop {
    admin: address,
}

public struct Unpaused has copy, drop {
    admin: address,
}

fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

public fun create_market<QuoteCoin, BaseCoin>(
    cap: &mut AdminCap,
    oracle_base: String,
    oracle: String,
    oracle_feed_id: vector<u8>,
    quote_decimals: u8,
    base_decimals: u8,
    strike_scale: u64,
    max_operational_fee_bps: u64,
    ctx: &mut TxContext,
): ID {
    assert!(max_operational_fee_bps <= BPS_DENOMINATOR, EInvalidOperationalFeeBps);
    let quote_coin_type = type_name::with_original_ids<QuoteCoin>();
    let base_coin_type = type_name::with_original_ids<BaseCoin>();
    let market_key = vector[
        oracle_base.into_bytes(),
        quote_coin_type.into_string().into_bytes(),
        base_coin_type.into_string().into_bytes(),
    ];
    assert!(!dynamic_field::exists(&cap.id, market_key), EMarketAlreadyExists);
    dynamic_field::add(&mut cap.id, market_key, true);
    let market = Market {
        id: object::new(ctx),
        oracle_base,
        oracle,
        oracle_feed_id,
        quote_decimals,
        base_decimals,
        strike_scale,
        max_operational_fee_bps,
        quote_coin_type,
        base_coin_type,
        admin_cap_id: object::id(cap),
        paused: false,
    };
    let market_id = object::id(&market);
    event::emit(MarketCreated {
        market_id,
        oracle_base: market.oracle_base,
        quote_coin_type,
        base_coin_type,
        oracle: market.oracle,
        oracle_feed_id: market.oracle_feed_id,
        max_operational_fee_bps,
    });
    transfer::share_object(market);
    market_id
}

public fun pause(market: &mut Market, cap: &AdminCap, ctx: &mut TxContext) {
    assert_admin(market, cap);
    market.paused = true;
    event::emit(Paused { admin: ctx.sender() });
}

public fun unpause(market: &mut Market, cap: &AdminCap, ctx: &mut TxContext) {
    assert_admin(market, cap);
    market.paused = false;
    event::emit(Unpaused { admin: ctx.sender() });
}

public(package) fun assert_supported_coin_types<QuoteCoin, BaseCoin>(market: &Market) {
    assert!(supports_coin_types<QuoteCoin, BaseCoin>(market), EUnsupportedCoinTypes);
}

public(package) fun assert_not_paused(market: &Market) {
    assert!(!market.paused, EPaused);
}

public(package) fun assert_admin(market: &Market, cap: &AdminCap) {
    assert!(market.admin_cap_id == object::id(cap), ENotAdmin);
}

public(package) fun uid_mut(market: &mut Market): &mut UID {
    &mut market.id
}

public(package) fun series_key(option_type: u8, strike_price: u64, expiry_ms: u64): SeriesKey {
    SeriesKey(option_type, strike_price, expiry_ms)
}

public fun derived_series_id(market: &Market, option_type: u8, strike_price: u64, expiry_ms: u64): ID {
    object::id_from_address(derived_object::derive_address(
        object::id(market),
        series_key(option_type, strike_price, expiry_ms),
    ))
}

public fun is_series_claimed(market: &Market, option_type: u8, strike_price: u64, expiry_ms: u64): bool {
    derived_object::exists(&market.id, series_key(option_type, strike_price, expiry_ms))
}

public fun supports_coin_types<QuoteCoin, BaseCoin>(market: &Market): bool {
    market.quote_coin_type == type_name::with_original_ids<QuoteCoin>()
        && market.base_coin_type == type_name::with_original_ids<BaseCoin>()
}

public fun id(market: &Market): ID {
    object::id(market)
}

public fun oracle_base(market: &Market): String {
    market.oracle_base
}

public fun oracle(market: &Market): String {
    market.oracle
}

public fun oracle_feed_id(market: &Market): &vector<u8> {
    &market.oracle_feed_id
}

public fun quote_decimals(market: &Market): u8 {
    market.quote_decimals
}

public fun base_decimals(market: &Market): u8 {
    market.base_decimals
}

public fun strike_scale(market: &Market): u64 {
    market.strike_scale
}

public fun max_operational_fee_bps(market: &Market): u64 {
    market.max_operational_fee_bps
}

public fun is_paused(market: &Market): bool {
    market.paused
}

public fun admin_cap_id(market: &Market): ID {
    market.admin_cap_id
}
