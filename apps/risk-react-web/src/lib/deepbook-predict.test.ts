import { bcs } from "@mysten/sui/bcs";
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import {
  DEEPBOOK_PREDICT,
  PREDICT_BINDINGS,
  PREDICT_SERVER_URL,
  createDepositAndMintPositionTransaction,
  createManagerDepositTransaction,
  createManagerTransaction,
  findLastTradeAsk,
  getOracleTrades,
  createRedeemAndWithdrawPositionTransaction,
  createMintPositionTransaction,
  createRedeemPositionTransaction,
  parseTokenAmount,
} from "./deepbook-predict.ts";

const BTC_ORACLE_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const BTC_ORACLE_SVI_ID =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const MANAGER_ID =
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const OWNER =
  "0x4444444444444444444444444444444444444444444444444444444444444444";
const EXECUTOR =
  "0x5555555555555555555555555555555555555555555555555555555555555555";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeepBook Predict transaction helpers", () => {
  it("builds manager creation and DUSDC deposit PTBs from centralized bindings", () => {
    assertMoveTarget(
      createManagerTransaction().getData().commands[0],
      PREDICT_BINDINGS.predictCreateManager,
    );

    const depositData = createManagerDepositTransaction(1_250_000n, MANAGER_ID).getData();
    assertMoveTarget(depositData.commands[1], PREDICT_BINDINGS.predictManagerDeposit);
    assert.deepEqual(moveCall(depositData.commands[1]).typeArguments, [
      DEEPBOOK_PREDICT.quote.type,
    ]);
  });

  it("constructs BTC market keys and mints with Predict, manager, OracleSVI, quantity, and Clock", () => {
    const data = createMintPositionTransaction({
      expiry: 1_767_225_600,
      isUp: true,
      managerId: MANAGER_ID,
      oracleId: BTC_ORACLE_ID,
      oracleSviId: BTC_ORACLE_SVI_ID,
      quantity: 7n,
      strike: 100_000,
    }).getData();

    assertMoveTarget(data.commands[0], PREDICT_BINDINGS.marketKeyNew);
    assertMoveTarget(data.commands[1], PREDICT_BINDINGS.predictMint);
    assert.deepEqual(moveCall(data.commands[1]).typeArguments, [
      DEEPBOOK_PREDICT.quote.type,
    ]);
    assert.deepEqual(moveCall(data.commands[1]).arguments.map(argumentKind), [
      "Input",
      "Input",
      "Input",
      "NestedResult",
      "Input",
      "Input",
    ]);

    assert.equal(objectInput(data, 4), DEEPBOOK_PREDICT.predictId);
    assert.equal(objectInput(data, 5), MANAGER_ID);
    assert.equal(objectInput(data, 6), BTC_ORACLE_SVI_ID);
    assert.equal(u64Input(data, 7), 7n);
    assert.equal(objectInput(data, 8), normalizedObjectId(DEEPBOOK_PREDICT.clockId));
  });

  it("composes manager DUSDC deposit before minting in one PTB", () => {
    const data = createDepositAndMintPositionTransaction({
      depositAmount: 4_200_000n,
      expiry: 1_767_225_600,
      isUp: true,
      managerId: MANAGER_ID,
      oracleId: BTC_ORACLE_ID,
      oracleSviId: BTC_ORACLE_SVI_ID,
      quantity: 2_000_000n,
      strike: 100_000,
    }).getData();

    assertMoveTarget(data.commands[1], PREDICT_BINDINGS.predictManagerDeposit);
    assertMoveTarget(data.commands[2], PREDICT_BINDINGS.marketKeyNew);
    assertMoveTarget(data.commands[3], PREDICT_BINDINGS.predictMint);
    assert.equal(objectInput(data, 0), MANAGER_ID);
    assert.equal(objectInput(data, 5), DEEPBOOK_PREDICT.predictId);
    assert.equal(objectInput(data, 6), BTC_ORACLE_SVI_ID);
    assert.equal(u64Input(data, 7), 2_000_000n);
  });

  it("chooses owner redeem for live/owned positions and permissionless redeem for settled third-party execution", () => {
    const base = {
      expiry: 1_767_225_600,
      isUp: false,
      managerId: MANAGER_ID,
      managerOwnerAddress: OWNER,
      oracleId: BTC_ORACLE_ID,
      oracleSviId: BTC_ORACLE_SVI_ID,
      quantity: 3n,
      strike: 95_000,
    };

    const ownerRedeem = createRedeemPositionTransaction({
      ...base,
      executorAddress: OWNER,
      oracleStatus: "settled",
    }).getData();
    assertMoveTarget(ownerRedeem.commands[1], PREDICT_BINDINGS.predictRedeem);

    const permissionlessRedeem = createRedeemPositionTransaction({
      ...base,
      executorAddress: EXECUTOR,
      oracleStatus: "settled",
    }).getData();
    assertMoveTarget(
      permissionlessRedeem.commands[1],
      PREDICT_BINDINGS.predictRedeemPermissionless,
    );

    const liveRedeem = createRedeemPositionTransaction({
      ...base,
      executorAddress: EXECUTOR,
      oracleStatus: "active",
    }).getData();
    assertMoveTarget(liveRedeem.commands[1], PREDICT_BINDINGS.predictRedeem);
  });

  it("can compose redeem and manager payout withdrawal in one PTB", () => {
    const data = createRedeemAndWithdrawPositionTransaction({
      expiry: 1_767_225_600,
      executorAddress: OWNER,
      isUp: true,
      managerId: MANAGER_ID,
      managerOwnerAddress: OWNER,
      oracleId: BTC_ORACLE_ID,
      oracleSviId: BTC_ORACLE_SVI_ID,
      oracleStatus: "active",
      quantity: 3n,
      recipient: OWNER,
      strike: 95_000,
      withdrawAmount: 1_500_000n,
    }).getData();

    assertMoveTarget(data.commands[1], PREDICT_BINDINGS.predictRedeem);
    assertMoveTarget(data.commands[2], PREDICT_BINDINGS.predictManagerWithdraw);
    assert.deepEqual(moveCall(data.commands[2]).typeArguments, [
      DEEPBOOK_PREDICT.quote.type,
    ]);
    assert.equal(u64Input(data, 9), 1_500_000n);
  });

  it("scales DUSDC token amounts to base units", () => {
    assert.equal(parseTokenAmount("1.25"), 1_250_000n);
    assert.equal(parseTokenAmount("0.000001"), 1n);
  });
});

describe("DeepBook Predict API helpers", () => {
  it("fetches oracle trades from the top-level trades endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => [],
      ok: true,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await getOracleTrades(BTC_ORACLE_ID);

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0]?.[0], `${PREDICT_SERVER_URL}/trades/${BTC_ORACLE_ID}`);
  });

  it("accepts the real trades payload shape with type and event metadata", async () => {
    const payload = [
      {
        ask_price: 691057628,
        checkpoint: 342047881,
        checkpoint_timestamp_ms: 1779967848758,
        cost: 69105762,
        digest: "6ipbrYH1PAgXQgdv2vcEEp32rM541i2he9CehHujWKWS",
        event_digest: "6ipbrYH1PAgXQgdv2vcEEp32rM541i2he9CehHujWKWS2",
        event_index: 2,
        expiry: 1780646400000,
        is_up: true,
        manager_id: "0x221e3269cc1758dc841e41b35b17dccfe53bb0c94ca23ca1ece3662e43ae9e7c",
        oracle_id: BTC_ORACLE_ID,
        package: "pkg",
        predict_id: "predict",
        quantity: 100000000,
        quote_asset: "dusdc",
        sender: OWNER,
        strike: 71350000000000,
        trader: OWNER,
        tx_index: 1,
        type: "mint",
      },
    ];
    const fetchMock = vi.fn(async () => ({
      json: async () => payload,
      ok: true,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const trades = await getOracleTrades(BTC_ORACLE_ID);

    assert.equal(trades[0]?.type, "mint");
    assert.equal(trades[0]?.event_digest, payload[0].event_digest);
    assert.equal(trades[0]?.checkpoint, payload[0].checkpoint);
  });

  it("finds the last mint ask and ignores later redeems", () => {
    const trades = [
      {
        ask_price: 500_000_000,
        checkpoint_timestamp_ms: 1779967740633,
        cost: 50_000_000,
        is_up: true,
        quantity: 100_000_000,
        strike: 73_450_000_000_000,
        type: "mint",
      },
      {
        bid_price: 462_198_000,
        checkpoint_timestamp_ms: 1779967805034,
        is_up: true,
        payout: 46_219_800,
        quantity: 100_000_000,
        strike: 73_450_000_000_000,
        type: "redeem",
      },
    ];

    assert.equal(findLastTradeAsk(trades, 73_450_000_000_000, true), 500_000_000);
  });
});

function assertMoveTarget(command: unknown, target: string) {
  const [packageId, module, fn] = splitTarget(target);
  const call = moveCall(command);

  assert.equal(call.package, normalizedObjectId(packageId));
  assert.equal(call.module, module);
  assert.equal(call.function, fn);
}

function moveCall(command: unknown) {
  assert.ok(command && typeof command === "object" && "MoveCall" in command);
  return (command as { MoveCall: MoveCallData }).MoveCall;
}

function splitTarget(target: string) {
  const parts = target.split("::");
  assert.equal(parts.length, 3);
  return parts as [string, string, string];
}

function argumentKind(argument: unknown) {
  assert.ok(argument && typeof argument === "object" && "$kind" in argument);
  return (argument as { $kind: string }).$kind;
}

function objectInput(data: TransactionData, index: number) {
  const input = data.inputs[index];
  assert.ok(input && "UnresolvedObject" in input);
  return input.UnresolvedObject.objectId;
}

function u64Input(data: TransactionData, index: number) {
  const input = data.inputs[index];
  assert.ok(input && "Pure" in input);
  return BigInt(bcs.U64.parse(Buffer.from(input.Pure.bytes, "base64")));
}

function normalizedObjectId(id: string) {
  return `0x${id.slice(2).padStart(64, "0")}`;
}

type TransactionData = ReturnType<ReturnType<typeof createManagerTransaction>["getData"]>;

type MoveCallData = {
  arguments: Array<unknown>;
  function: string;
  module: string;
  package: string;
  typeArguments: Array<string>;
};
