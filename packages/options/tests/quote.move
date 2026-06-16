#[test_only]
module options_trading_protocol::quote;

use sui::coin::{Self, CoinMetadata, TreasuryCap};

public struct QUOTE has drop {}

#[allow(deprecated_usage)]
public fun create(ctx: &mut TxContext): (TreasuryCap<QUOTE>, CoinMetadata<QUOTE>) {
    coin::create_currency(
        QUOTE {},
        6,
        b"QUOTE",
        b"Quote",
        b"Quote coin",
        option::none(),
        ctx,
    )
}
