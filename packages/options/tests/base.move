#[test_only]
module options_trading_protocol::base;

use sui::coin::{Self, CoinMetadata, TreasuryCap};

public struct BASE has drop {}

#[allow(deprecated_usage)]
public fun create(ctx: &mut TxContext): (TreasuryCap<BASE>, CoinMetadata<BASE>) {
    coin::create_currency(
        BASE {},
        9,
        b"BASE",
        b"Base",
        b"Base coin",
        option::none(),
        ctx,
    )
}
