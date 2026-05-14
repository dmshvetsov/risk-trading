import type { SuiClient } from "@mysten/sui/client";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";

export const DEEPBOOK_PREDICT = {
  network: "testnet",
  packageId: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138",
  predictId: "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a",
  clockId: "0x6",
  quote: {
    symbol: "DUSDC",
    decimals: 9,
    type: "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC",
  },
  plp: {
    symbol: "PLP",
    decimals: 9,
    type: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP",
  },
} as const;

const DUMMY_SENDER =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

type MoveObjectContent = {
  dataType: "moveObject";
  fields: {
    treasury_cap: {
      fields: {
        total_supply: {
          fields: {
            value: string;
          };
        };
      };
    };
    vault: {
      fields: {
        balance: string;
        total_max_payout: string;
        total_mtm: string;
      };
    };
    withdrawal_limiter: {
      fields: {
        available: string;
        capacity: string;
        enabled: boolean;
      };
    };
  };
};

export type VaultSummary = {
  acceptedQuoteType: string;
  availableWithdrawal: bigint;
  limiterAvailable: bigint;
  limiterCapacity: bigint;
  limiterEnabled: boolean;
  totalBalance: bigint;
  totalMaxPayout: bigint;
  totalMtm: bigint;
  totalPlpSupply: bigint;
  vaultValue: bigint;
};

export type WalletVaultBalances = {
  plp: bigint;
  quote: bigint;
};

export async function getVaultSummary(
  client: SuiClient,
  sender = DUMMY_SENDER,
): Promise<VaultSummary> {
  const [objectResponse, rawAvailableWithdrawal] = await Promise.all([
    client.getObject({
      id: DEEPBOOK_PREDICT.predictId,
      options: { showContent: true },
    }),
    getAvailableWithdrawal(client, sender),
  ]);

  const content = objectResponse.data?.content;
  if (!content || content.dataType !== "moveObject") {
    throw new Error("Predict object content is unavailable");
  }

  const fields = (content as MoveObjectContent).fields;
  const totalBalance = BigInt(fields.vault.fields.balance);
  const totalMtm = BigInt(fields.vault.fields.total_mtm);
  const totalMaxPayout = BigInt(fields.vault.fields.total_max_payout);
  const coverageAvailable =
    totalBalance > totalMaxPayout ? totalBalance - totalMaxPayout : 0n;

  return {
    acceptedQuoteType: DEEPBOOK_PREDICT.quote.type,
    availableWithdrawal:
      rawAvailableWithdrawal > coverageAvailable
        ? coverageAvailable
        : rawAvailableWithdrawal,
    limiterAvailable: BigInt(fields.withdrawal_limiter.fields.available),
    limiterCapacity: BigInt(fields.withdrawal_limiter.fields.capacity),
    limiterEnabled: fields.withdrawal_limiter.fields.enabled,
    totalBalance,
    totalMaxPayout,
    totalMtm,
    totalPlpSupply: BigInt(
      fields.treasury_cap.fields.total_supply.fields.value,
    ),
    vaultValue: totalBalance - totalMtm,
  };
}

export async function getWalletVaultBalances(
  client: SuiClient,
  owner: string,
): Promise<WalletVaultBalances> {
  const [quote, plp] = await Promise.all([
    client.getBalance({ owner, coinType: DEEPBOOK_PREDICT.quote.type }),
    client.getBalance({ owner, coinType: DEEPBOOK_PREDICT.plp.type }),
  ]);

  return {
    plp: BigInt(plp.totalBalance),
    quote: BigInt(quote.totalBalance),
  };
}

export function createSupplyTransaction(amount: bigint, recipient: string) {
  const tx = new Transaction();
  const quoteCoin = tx.coin({
    type: DEEPBOOK_PREDICT.quote.type,
    balance: amount,
  });
  const [plpCoin] = tx.moveCall({
    target: `${DEEPBOOK_PREDICT.packageId}::predict::supply`,
    typeArguments: [DEEPBOOK_PREDICT.quote.type],
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      quoteCoin,
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  tx.transferObjects([plpCoin], recipient);
  return tx;
}

export function createWithdrawTransaction(amount: bigint, recipient: string) {
  const tx = new Transaction();
  const plpCoin = tx.coin({
    type: DEEPBOOK_PREDICT.plp.type,
    balance: amount,
  });
  const [quoteCoin] = tx.moveCall({
    target: `${DEEPBOOK_PREDICT.packageId}::predict::withdraw`,
    typeArguments: [DEEPBOOK_PREDICT.quote.type],
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      plpCoin,
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  tx.transferObjects([quoteCoin], recipient);
  return tx;
}

export async function getAvailableWithdrawal(
  client: SuiClient,
  sender = DUMMY_SENDER,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${DEEPBOOK_PREDICT.packageId}::predict::available_withdrawal`,
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  const result = await client.devInspectTransactionBlock({
    sender,
    transactionBlock: tx,
  });
  const [returnValue] = result.results?.[0]?.returnValues ?? [];
  if (!returnValue) {
    throw new Error("Unable to read available withdrawal amount");
  }

  return bcs.U64.parse(Uint8Array.from(returnValue[0]));
}

export function parseTokenAmount(
  value: string,
  decimals = DEEPBOOK_PREDICT.quote.decimals,
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0n;
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid amount");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Use no more than ${decimals} decimal places`);
  }

  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

export function formatTokenAmount(
  value: bigint,
  decimals = DEEPBOOK_PREDICT.quote.decimals,
) {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionText = fraction.toString().padStart(decimals, "0");
  const trimmedFraction = fractionText.replace(/0+$/, "").slice(0, 4);

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

export function getSuiExplorerTxUrl(digest: string) {
  return `https://suiscan.xyz/testnet/tx/${digest}`;
}
