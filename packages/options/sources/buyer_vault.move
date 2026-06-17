module options_trading_protocol::buyer_vault;

use std::type_name::{Self, TypeName};
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

const ENotOwner: u64 = 0;
const EInsufficientBalance: u64 = 1;

public struct BuyerVault<phantom QuoteCoin> has key {
    id: UID,
    owner: address,
    balance: Balance<QuoteCoin>,
}

public struct BuyerVaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
    quote_coin_type: TypeName,
}

public struct BuyerVaultDeposited has copy, drop {
    vault_id: ID,
    owner: address,
    quote_coin_type: TypeName,
    amount: u64,
}

public struct BuyerVaultWithdrawn has copy, drop {
    vault_id: ID,
    owner: address,
    quote_coin_type: TypeName,
    amount: u64,
}

public struct BuyerVaultClosed has copy, drop {
    vault_id: ID,
    owner: address,
    quote_coin_type: TypeName,
    last_withdrawal_amount: u64,
}

public fun create_vault<QuoteCoin>(ctx: &mut TxContext): ID {
    let owner = ctx.sender();
    let vault = BuyerVault<QuoteCoin> {
        id: object::new(ctx),
        owner,
        balance: balance::zero(),
    };
    let vault_id = object::id(&vault);
    event::emit(BuyerVaultCreated {
        vault_id,
        owner,
        quote_coin_type: type_name::with_original_ids<QuoteCoin>(),
    });
    transfer::share_object(vault);
    vault_id
}

public fun deposit<QuoteCoin>(
    vault: &mut BuyerVault<QuoteCoin>,
    payment: Coin<QuoteCoin>,
    ctx: &TxContext,
) {
    assert_owner(vault, ctx);
    let amount = payment.value();
    vault.balance.join(payment.into_balance());
    event::emit(BuyerVaultDeposited {
        vault_id: object::id(vault),
        owner: vault.owner,
        quote_coin_type: type_name::with_original_ids<QuoteCoin>(),
        amount,
    });
}

public fun withdraw<QuoteCoin>(
    vault: &mut BuyerVault<QuoteCoin>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<QuoteCoin> {
    assert_owner(vault, ctx);
    assert!(amount <= vault.balance.value(), EInsufficientBalance);
    let withdrawn = coin::from_balance(vault.balance.split(amount), ctx);
    event::emit(BuyerVaultWithdrawn {
        vault_id: object::id(vault),
        owner: vault.owner,
        quote_coin_type: type_name::with_original_ids<QuoteCoin>(),
        amount,
    });
    withdrawn
}

public fun close_vault<QuoteCoin>(
    vault: BuyerVault<QuoteCoin>,
    ctx: &mut TxContext,
): Coin<QuoteCoin> {
    assert_owner(&vault, ctx);
    let vault_id = object::id(&vault);
    let BuyerVault { id, owner, balance } = vault;
    let last_withdrawal_amount = balance.value();
    let withdrawn = coin::from_balance(balance, ctx);
    id.delete();
    event::emit(BuyerVaultClosed {
        vault_id,
        owner,
        quote_coin_type: type_name::with_original_ids<QuoteCoin>(),
        last_withdrawal_amount,
    });
    withdrawn
}

fun assert_owner<QuoteCoin>(vault: &BuyerVault<QuoteCoin>, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
}

public fun owner<QuoteCoin>(vault: &BuyerVault<QuoteCoin>): address { vault.owner }
public fun balance<QuoteCoin>(vault: &BuyerVault<QuoteCoin>): u64 { vault.balance.value() }

public fun created_vault_id(event: &BuyerVaultCreated): ID { event.vault_id }
public fun created_owner(event: &BuyerVaultCreated): address { event.owner }
public fun created_quote_coin_type(event: &BuyerVaultCreated): TypeName { event.quote_coin_type }

public fun deposited_vault_id(event: &BuyerVaultDeposited): ID { event.vault_id }
public fun deposited_owner(event: &BuyerVaultDeposited): address { event.owner }
public fun deposited_quote_coin_type(event: &BuyerVaultDeposited): TypeName { event.quote_coin_type }
public fun deposited_amount(event: &BuyerVaultDeposited): u64 { event.amount }

public fun withdrawn_vault_id(event: &BuyerVaultWithdrawn): ID { event.vault_id }
public fun withdrawn_owner(event: &BuyerVaultWithdrawn): address { event.owner }
public fun withdrawn_quote_coin_type(event: &BuyerVaultWithdrawn): TypeName { event.quote_coin_type }
public fun withdrawn_amount(event: &BuyerVaultWithdrawn): u64 { event.amount }

public fun closed_vault_id(event: &BuyerVaultClosed): ID { event.vault_id }
public fun closed_owner(event: &BuyerVaultClosed): address { event.owner }
public fun closed_quote_coin_type(event: &BuyerVaultClosed): TypeName { event.quote_coin_type }
public fun closed_last_withdrawal_amount(event: &BuyerVaultClosed): u64 { event.last_withdrawal_amount }
