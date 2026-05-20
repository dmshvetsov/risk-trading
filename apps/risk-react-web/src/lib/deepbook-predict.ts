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
    decimals: 6,
    type: "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC",
  },
  plp: {
    symbol: "PLP",
    decimals: 6,
    type: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP",
  },
} as const;

export const PREDICT_SERVER_URL = "https://predict-server.testnet.mystenlabs.com";
export const FLOAT_SCALING = 1_000_000_000;

export const PREDICT_BINDINGS = {
  marketKeyNew: `${DEEPBOOK_PREDICT.packageId}::market_key::new`,
  predictAvailableWithdrawal: `${DEEPBOOK_PREDICT.packageId}::predict::available_withdrawal`,
  predictCreateManager: `${DEEPBOOK_PREDICT.packageId}::predict::create_manager`,
  predictGetTradeAmounts: `${DEEPBOOK_PREDICT.packageId}::predict::get_trade_amounts`,
  predictManagerDeposit: `${DEEPBOOK_PREDICT.packageId}::predict_manager::deposit`,
  predictMint: `${DEEPBOOK_PREDICT.packageId}::predict::mint`,
  predictRedeem: `${DEEPBOOK_PREDICT.packageId}::predict::redeem`,
  predictRedeemPermissionless: `${DEEPBOOK_PREDICT.packageId}::predict::redeem_permissionless`,
  predictSupply: `${DEEPBOOK_PREDICT.packageId}::predict::supply`,
  predictWithdraw: `${DEEPBOOK_PREDICT.packageId}::predict::withdraw`,
} as const;

const DUMMY_SENDER =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

export type PredictOracle = {
  activated_at: number;
  created_checkpoint: number;
  expiry: number;
  min_strike: number;
  oracle_cap_id: string;
  oracle_id: string;
  predict_id: string;
  settled_at: number | null;
  settlement_price: number | null;
  status: string;
  tick_size: number;
  underlying_asset: string;
};

export type OraclePriceUpdate = {
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  digest: string;
  event_digest: string;
  event_index: number;
  forward: number;
  onchain_timestamp: number;
  oracle_id: string;
  package: string;
  sender: string;
  spot: number;
  tx_index: number;
};

export type OracleSviUpdate = {
  a: number;
  b: number;
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  digest: string;
  event_digest: string;
  event_index: number;
  m: number;
  m_negative: boolean;
  onchain_timestamp: number;
  oracle_id: string;
  package: string;
  rho: number;
  rho_negative: boolean;
  sender: string;
  sigma: number;
  tx_index: number;
};

export type OracleAskBounds = {
  min_ask_price: number;
  max_ask_price: number;
};

export type OracleStateResponse = {
  ask_bounds: OracleAskBounds | null;
  latest_price: OraclePriceUpdate | null;
  latest_svi: OracleSviUpdate | null;
  oracle: PredictOracle;
};

export type OracleTrade = {
  ask_price?: number;
  bid_price?: number;
  cost?: number;
  expiry?: number;
  is_up?: boolean;
  oracle_id?: string;
  quantity?: number;
  strike?: number;
  timestamp?: number;
  tx_timestamp_ms?: number;
};

export type SviPoint = {
  d2: number;
  dnFair: number;
  impliedVol: number;
  k: number;
  strike: number;
  totalVariance: number;
  upFair: number;
};

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

type PredictManagerObjectContent = {
  dataType: "moveObject";
  fields: {
    balance_manager: {
      fields: {
        balances: {
          fields: {
            id: {
              id: string;
            };
          };
        };
        id: {
          id: string;
        };
      };
    };
    owner: string;
    positions: {
      fields: {
        size: string;
      };
    };
    range_positions: {
      fields: {
        size: string;
      };
    };
  };
};

type DynamicFieldObjectContent = {
  dataType: "moveObject";
  fields: {
    value: string;
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

export type PredictManagerEvent = {
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  digest: string;
  event_digest: string;
  event_index: number;
  manager_id: string;
  owner: string;
  sender: string;
  tx_index: number;
};

export type PredictManagerSummary = {
  balanceManagerId: string;
  createdAtMs: number;
  createdCheckpoint: number;
  digest: string;
  hasPositions: boolean;
  id: string;
  owner: string;
  positionsSize: number;
  quoteBalance: bigint;
  rangePositionsSize: number;
};

export type OracleTradeAmounts = {
  mintCost: bigint;
  redeemPayout: bigint;
};

type OracleTradeAmountsInput = {
  expiry: number;
  isUp: boolean;
  oracleId: string;
  quantity: bigint;
  strike: number;
};

export type MarketKeyInput = {
  expiry: number;
  isUp: boolean;
  oracleId: string;
  strike: number;
};

export type PredictPositionTransactionInput = MarketKeyInput & {
  managerId: string;
  oracleSviId: string;
  quantity: bigint;
};

export type FundedPredictPositionTransactionInput =
  PredictPositionTransactionInput & {
    depositAmount: bigint;
  };

export type PredictRedeemTransactionInput = PredictPositionTransactionInput & {
  executorAddress: string;
  managerOwnerAddress: string;
  oracleStatus: PredictOracle["status"];
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

export async function getOracleState(oracleId: string): Promise<OracleStateResponse> {
  const response = await fetch(`${PREDICT_SERVER_URL}/oracles/${oracleId}/state`);

  if (!response.ok) {
    throw new Error(`Oracle state request failed with ${response.status}`);
  }

  return (await response.json()) as OracleStateResponse;
}

export async function getOracleTrades(oracleId: string): Promise<Array<OracleTrade>> {
  const response = await fetch(`${PREDICT_SERVER_URL}/oracles/${oracleId}/trades`);

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload as Array<OracleTrade>;
  }

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { trades?: unknown }).trades)
  ) {
    return (payload as { trades: Array<OracleTrade> }).trades;
  }

  return [];
}

export async function getWalletPredictManager(
  client: SuiClient,
  owner: string,
): Promise<PredictManagerSummary | null> {
  const response = await fetch(
    `${PREDICT_SERVER_URL}/managers?owner=${encodeURIComponent(owner)}`,
  );

  if (!response.ok) {
    throw new Error(`Manager request failed with ${response.status}`);
  }

  const events = ((await response.json()) as Array<PredictManagerEvent>)
    .filter((event) => normalizeSuiAddress(event.owner) === normalizeSuiAddress(owner))
    .sort((a, b) => {
      if (b.checkpoint !== a.checkpoint) {
        return b.checkpoint - a.checkpoint;
      }

      return b.tx_index - a.tx_index;
    });
  const managerEvent = events[0];

  if (!managerEvent) {
    return null;
  }

  const objectResponse = await client.getObject({
    id: managerEvent.manager_id,
    options: { showContent: true },
  });
  const content = objectResponse.data?.content;

  if (!content || content.dataType !== "moveObject") {
    throw new Error("PredictManager object content is unavailable");
  }

  const fields = (content as PredictManagerObjectContent).fields;
  const positionsSize = Number(fields.positions.fields.size);
  const rangePositionsSize = Number(fields.range_positions.fields.size);

  return {
    balanceManagerId: fields.balance_manager.fields.id.id,
    createdAtMs: managerEvent.checkpoint_timestamp_ms,
    createdCheckpoint: managerEvent.checkpoint,
    digest: managerEvent.digest,
    hasPositions: positionsSize > 0 || rangePositionsSize > 0,
    id: managerEvent.manager_id,
    owner: fields.owner,
    positionsSize,
    quoteBalance: await getManagerQuoteBalance(
      client,
      fields.balance_manager.fields.balances.fields.id.id,
    ),
    rangePositionsSize,
  };
}

export function decodeSignedScaled(value: number, isNegative: boolean) {
  const magnitude = value / FLOAT_SCALING;
  return isNegative ? -magnitude : magnitude;
}

export function computeSviPoint(
  strike: number,
  state: OracleStateResponse,
): SviPoint | null {
  const { latest_price: price, latest_svi: svi, oracle } = state;

  if (!price || !svi || price.forward <= 0 || strike <= 0) {
    return null;
  }

  const a = svi.a / FLOAT_SCALING;
  const b = svi.b / FLOAT_SCALING;
  const rho = decodeSignedScaled(svi.rho, svi.rho_negative);
  const m = decodeSignedScaled(svi.m, svi.m_negative);
  const sigma = svi.sigma / FLOAT_SCALING;
  const k = Math.log(strike / price.forward);
  const kMinusM = k - m;
  const inner = rho * kMinusM + Math.sqrt(kMinusM ** 2 + sigma ** 2);
  const totalVariance = Math.max(a + b * inner, Number.EPSILON);
  const sqrtVariance = Math.sqrt(totalVariance);
  const d2 = -((k + totalVariance / 2) / sqrtVariance);
  const settlement = oracle.settlement_price;
  const upFair =
    oracle.status === "settled" && settlement !== null
      ? settlement > strike
        ? 1
        : 0
      : normalCdf(d2);

  return {
    d2,
    dnFair: 1 - upFair,
    impliedVol: sqrtVariance,
    k,
    strike,
    totalVariance,
    upFair,
  };
}

export function buildSviCurve(state: OracleStateResponse) {
  const { oracle } = state;
  const points: Array<SviPoint> = [];
  const forward = state.latest_price?.forward ?? oracle.min_strike;
  const lowerStrike = Math.max(oracle.min_strike, forward * 0.75);
  const upperStrike = Math.max(lowerStrike + oracle.tick_size, forward * 1.25);
  const samples = 120;
  let lastStrike = 0;

  for (let index = 0; index <= samples; index += 1) {
    const rawStrike = lowerStrike + ((upperStrike - lowerStrike) * index) / samples;
    const strike = Math.max(
      oracle.min_strike,
      Math.round(rawStrike / oracle.tick_size) * oracle.tick_size,
    );

    if (strike === lastStrike) {
      continue;
    }

    const point = computeSviPoint(strike, state);
    if (point) {
      points.push(point);
      lastStrike = strike;
    }
  }

  return points;
}

export function findLastTradeAsk(
  trades: Array<OracleTrade>,
  strike: number,
  isUp: boolean,
) {
  const trade = [...trades]
    .reverse()
    .find((candidate) => candidate.strike === strike && candidate.is_up === isUp);

  return trade?.ask_price ?? trade?.cost ?? null;
}

function normalCdf(value: number) {
  return (1 + erf(value / Math.SQRT2)) / 2;
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));

  return sign * y;
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

async function getManagerQuoteBalance(client: SuiClient, balancesBagId: string) {
  const fields = await client.getDynamicFields({ parentId: balancesBagId });
  const quoteField = fields.data.find(
    (field) =>
      field.objectType.includes("::balance::Balance<") &&
      field.objectType.includes(DEEPBOOK_PREDICT.quote.type),
  );

  if (!quoteField) {
    return 0n;
  }

  const objectResponse = await client.getObject({
    id: quoteField.objectId,
    options: { showContent: true },
  });
  const content = objectResponse.data?.content;

  if (!content || content.dataType !== "moveObject") {
    throw new Error("PredictManager quote balance is unavailable");
  }

  return BigInt((content as DynamicFieldObjectContent).fields.value);
}

export function createSupplyTransaction(amount: bigint, recipient: string) {
  const tx = new Transaction();
  const quoteCoin = tx.coin({
    type: DEEPBOOK_PREDICT.quote.type,
    balance: amount,
  });
  const [plpCoin] = tx.moveCall({
    target: PREDICT_BINDINGS.predictSupply,
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
    target: PREDICT_BINDINGS.predictWithdraw,
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

export function createManagerTransaction() {
  const tx = new Transaction();
  tx.moveCall({
    target: PREDICT_BINDINGS.predictCreateManager,
  });

  return tx;
}

export function createManagerDepositTransaction(amount: bigint, managerId: string) {
  const tx = new Transaction();
  const quoteCoin = tx.coin({
    type: DEEPBOOK_PREDICT.quote.type,
    balance: amount,
  });

  tx.moveCall({
    target: PREDICT_BINDINGS.predictManagerDeposit,
    typeArguments: [DEEPBOOK_PREDICT.quote.type],
    arguments: [tx.object(managerId), quoteCoin],
  });

  return tx;
}

export function createMintPositionTransaction(
  input: PredictPositionTransactionInput,
) {
  const tx = new Transaction();
  const key = createMarketKey(tx, input);

  tx.moveCall({
    target: PREDICT_BINDINGS.predictMint,
    typeArguments: [DEEPBOOK_PREDICT.quote.type],
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      tx.object(input.managerId),
      tx.object(input.oracleSviId),
      key,
      tx.pure.u64(input.quantity),
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  return tx;
}

export function createDepositAndMintPositionTransaction(
  input: FundedPredictPositionTransactionInput,
) {
  const tx = new Transaction();

  if (input.depositAmount > 0n) {
    const quoteCoin = tx.coin({
      type: DEEPBOOK_PREDICT.quote.type,
      balance: input.depositAmount,
    });

    tx.moveCall({
      target: PREDICT_BINDINGS.predictManagerDeposit,
      typeArguments: [DEEPBOOK_PREDICT.quote.type],
      arguments: [tx.object(input.managerId), quoteCoin],
    });
  }

  const key = createMarketKey(tx, input);

  tx.moveCall({
    target: PREDICT_BINDINGS.predictMint,
    typeArguments: [DEEPBOOK_PREDICT.quote.type],
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      tx.object(input.managerId),
      tx.object(input.oracleSviId),
      key,
      tx.pure.u64(input.quantity),
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  return tx;
}

export function createRedeemPositionTransaction(
  input: PredictRedeemTransactionInput,
) {
  const tx = new Transaction();
  const key = createMarketKey(tx, input);
  const isManagerOwner =
    normalizeSuiAddress(input.executorAddress) ===
    normalizeSuiAddress(input.managerOwnerAddress);
  const target =
    input.oracleStatus === "settled" && !isManagerOwner
      ? PREDICT_BINDINGS.predictRedeemPermissionless
      : PREDICT_BINDINGS.predictRedeem;

  tx.moveCall({
    target,
    typeArguments: [DEEPBOOK_PREDICT.quote.type],
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      tx.object(input.managerId),
      tx.object(input.oracleSviId),
      key,
      tx.pure.u64(input.quantity),
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  return tx;
}

export async function getAvailableWithdrawal(
  client: SuiClient,
  sender = DUMMY_SENDER,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: PREDICT_BINDINGS.predictAvailableWithdrawal,
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

  return parseU64Return(returnValue[0]);
}

export async function getOracleTradeAmounts(
  client: SuiClient,
  input: OracleTradeAmountsInput,
  sender = DUMMY_SENDER,
): Promise<OracleTradeAmounts> {
  const tx = new Transaction();
  const key = createMarketKey(tx, input);

  tx.moveCall({
    target: PREDICT_BINDINGS.predictGetTradeAmounts,
    arguments: [
      tx.object(DEEPBOOK_PREDICT.predictId),
      tx.object(input.oracleId),
      key,
      tx.pure.u64(input.quantity),
      tx.object(DEEPBOOK_PREDICT.clockId),
    ],
  });

  const result = await client.devInspectTransactionBlock({
    sender,
    transactionBlock: tx,
  });

  const [mintCost, redeemPayout] = result.results?.[1]?.returnValues ?? [];
  if (!mintCost || !redeemPayout) {
    throw new Error("Unable to read trade amount preview");
  }

  return {
    mintCost: parseU64Return(mintCost[0]),
    redeemPayout: parseU64Return(redeemPayout[0]),
  };
}

export function createMarketKey(tx: Transaction, input: MarketKeyInput) {
  const [key] = tx.moveCall({
    target: PREDICT_BINDINGS.marketKeyNew,
    arguments: [
      tx.pure.id(input.oracleId),
      tx.pure.u64(input.expiry),
      tx.pure.u64(input.strike),
      tx.pure.bool(input.isUp),
    ],
  });

  return key;
}

function normalizeSuiAddress(address: string) {
  return address.toLowerCase();
}

function parseU64Return(bytes: Array<number>) {
  return BigInt(bcs.U64.parse(Uint8Array.from(bytes)));
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

export function getSuiExplorerTxUrl(digest: string) {
  return `https://suiscan.xyz/testnet/tx/${digest}`;
}
