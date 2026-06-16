module options_trading_protocol::pyth_oracle_unverifiable;

use options_trading_protocol::market::{Self, AdminCap, Market};
use options_trading_protocol::series::{Self, ExpiryPrice};

const EUnsupportedOracle: u64 = 0;

public fun create_expiry_price(
    market: &Market,
    cap: &AdminCap,
    expiry_ms: u64,
    expiry_price: u64,
    publish_time_ms: u64,
    price_payload_hash: vector<u8>,
): ExpiryPrice {
    market::assert_admin(market, cap);
    assert!(market::oracle(market) == "pyth", EUnsupportedOracle);
    series::new_expiry_price(
        market::id(market),
        market::oracle(market),
        *market::oracle_feed_id(market),
        expiry_ms,
        expiry_price,
        publish_time_ms,
        price_payload_hash,
    )
}
