module options_trading_protocol::market;

use std::string::String;
use std::type_name::{Self, TypeName};
use sui::event;

const ENotAdmin: u64 = 0;
const EUnsupportedCoinTypes: u64 = 1;
const EPaused: u64 = 2;

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
    cap: &AdminCap,
    oracle_base: String,
    oracle: String,
    oracle_feed_id: vector<u8>,
    quote_decimals: u8,
    base_decimals: u8,
    strike_scale: u64,
    ctx: &mut TxContext,
) {
    let quote_coin_type = type_name::with_original_ids<QuoteCoin>();
    let base_coin_type = type_name::with_original_ids<BaseCoin>();
    let market = Market {
        id: object::new(ctx),
        oracle_base,
        oracle,
        oracle_feed_id,
        quote_decimals,
        base_decimals,
        strike_scale,
        quote_coin_type,
        base_coin_type,
        admin_cap_id: object::id(cap),
        paused: false,
    };
    event::emit(MarketCreated {
        market_id: object::id(&market),
        oracle_base: market.oracle_base,
        quote_coin_type,
        base_coin_type,
        oracle: market.oracle,
        oracle_feed_id: market.oracle_feed_id,
    });
    transfer::share_object(market);
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

public fun supports_coin_types<QuoteCoin, BaseCoin>(market: &Market): bool {
    market.quote_coin_type == type_name::with_original_ids<QuoteCoin>()
        && market.base_coin_type == type_name::with_original_ids<BaseCoin>()
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

public fun is_paused(market: &Market): bool {
    market.paused
}

public fun admin_cap_id(market: &Market): ID {
    market.admin_cap_id
}

fun assert_admin(market: &Market, cap: &AdminCap) {
    assert!(market.admin_cap_id == object::id(cap), ENotAdmin);
}
