module options_trading_protocol::long;

const ELongMismatch: u64 = 0;
const EInsufficientQuantity: u64 = 1;

public struct Long<phantom QuoteCoin, phantom BaseCoin> has key, store {
    id: UID,
    market_id: ID,
    series_id: ID,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    quantity: u64,
}

public(package) fun mint<QuoteCoin, BaseCoin>(
    market_id: ID,
    series_id: ID,
    option_type: u8,
    strike_price: u64,
    expiry_ms: u64,
    quantity: u64,
    ctx: &mut TxContext,
): Long<QuoteCoin, BaseCoin> {
    Long {
        id: object::new(ctx),
        market_id,
        series_id,
        option_type,
        strike_price,
        expiry_ms,
        quantity,
    }
}

public fun split<QuoteCoin, BaseCoin>(
    long: &mut Long<QuoteCoin, BaseCoin>,
    quantity: u64,
    ctx: &mut TxContext,
): Long<QuoteCoin, BaseCoin> {
    assert!(quantity <= long.quantity, EInsufficientQuantity);
    long.quantity = long.quantity - quantity;
    Long {
        id: object::new(ctx),
        market_id: long.market_id,
        series_id: long.series_id,
        option_type: long.option_type,
        strike_price: long.strike_price,
        expiry_ms: long.expiry_ms,
        quantity,
    }
}

public fun join<QuoteCoin, BaseCoin>(
    target: &mut Long<QuoteCoin, BaseCoin>,
    source: Long<QuoteCoin, BaseCoin>,
) {
    let Long { id, market_id, series_id, option_type, strike_price, expiry_ms, quantity } = source;
    assert!(target.market_id == market_id, ELongMismatch);
    assert!(target.series_id == series_id, ELongMismatch);
    assert!(target.option_type == option_type, ELongMismatch);
    assert!(target.strike_price == strike_price, ELongMismatch);
    assert!(target.expiry_ms == expiry_ms, ELongMismatch);
    id.delete();
    target.quantity = target.quantity + quantity;
}

public(package) fun burn<QuoteCoin, BaseCoin>(
    long: Long<QuoteCoin, BaseCoin>,
): (ID, ID, u8, u64, u64, u64) {
    let Long { id, market_id, series_id, option_type, strike_price, expiry_ms, quantity } = long;
    id.delete();
    (market_id, series_id, option_type, strike_price, expiry_ms, quantity)
}

public fun market_id<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): ID {
    long.market_id
}

public fun series_id<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): ID {
    long.series_id
}

public fun option_type<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u8 {
    long.option_type
}

public fun strike_price<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u64 {
    long.strike_price
}

public fun expiry_ms<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u64 {
    long.expiry_ms
}

public fun quantity<QuoteCoin, BaseCoin>(long: &Long<QuoteCoin, BaseCoin>): u64 {
    long.quantity
}
