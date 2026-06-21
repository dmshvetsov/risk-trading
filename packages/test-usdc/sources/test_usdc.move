module test_usdc::test_usdc;

use std::option;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::transfer;
use sui::tx_context::TxContext;

const DECIMALS: u8 = 6;
const SYMBOL: vector<u8> = b"tUSDC";
const NAME: vector<u8> = b"testUSDC";
const DESCRIPTION: vector<u8> = b"Development-only USDC for Sui testnet";

public struct TEST_USDC has drop {}

#[allow(deprecated_usage)]
fun init(witness: TEST_USDC, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency(
        witness,
        DECIMALS,
        SYMBOL,
        NAME,
        DESCRIPTION,
        option::none(),
        ctx,
    );

    transfer::public_transfer(treasury_cap, ctx.sender());
    transfer::public_freeze_object(metadata);
}

public fun mint(cap: &mut TreasuryCap<TEST_USDC>, amount: u64, ctx: &mut TxContext): Coin<TEST_USDC> {
    coin::mint(cap, amount, ctx)
}

entry fun mint_and_transfer(
    cap: &mut TreasuryCap<TEST_USDC>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let coin = mint(cap, amount, ctx);
    transfer::public_transfer(coin, recipient);
}

public fun burn(cap: &mut TreasuryCap<TEST_USDC>, coin: Coin<TEST_USDC>): u64 {
    coin::burn(cap, coin)
}

public fun total_supply(cap: &TreasuryCap<TEST_USDC>): u64 {
    coin::total_supply(cap)
}

#[test_only]
#[allow(deprecated_usage)]
public(package) fun init_for_testing(ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency(
        TEST_USDC {},
        DECIMALS,
        SYMBOL,
        NAME,
        DESCRIPTION,
        option::none(),
        ctx,
    );

    transfer::public_transfer(treasury_cap, ctx.sender());
    transfer::public_freeze_object(metadata);
}
