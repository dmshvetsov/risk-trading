import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEEPBOOK_PREDICT,
  type VaultSummary,
  type WalletVaultBalances,
  createSupplyTransaction,
  createWithdrawTransaction,
  formatTokenAmount,
  getSuiExplorerTxUrl,
  getVaultSummary,
  getWalletVaultBalances,
  parseTokenAmount,
} from "@/lib/deepbook-predict";
import { truncateAddress } from "@/lib/format";

type VaultMode = "supply" | "withdraw";

export const Route = createFileRoute("/vaults")({
  component: Vaults,
});

function Vaults() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction, isPending } =
    useSignAndExecuteTransaction();
  const [mode, setMode] = useState<VaultMode>("supply");
  const [amount, setAmount] = useState("");
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [balances, setBalances] = useState<WalletVaultBalances | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);

  const parsedAmount = useMemo(() => {
    try {
      return parseTokenAmount(amount);
    } catch {
      return null;
    }
  }, [amount]);

  const estimatedOutput = useMemo(() => {
    if (!summary || parsedAmount === null || parsedAmount === 0n) {
      return 0n;
    }

    if (mode === "supply") {
      if (summary.totalPlpSupply === 0n || summary.vaultValue <= 0n) {
        return parsedAmount;
      }

      return (parsedAmount * summary.totalPlpSupply) / summary.vaultValue;
    }

    if (summary.totalPlpSupply === 0n) {
      return 0n;
    }

    return (parsedAmount * summary.vaultValue) / summary.totalPlpSupply;
  }, [mode, parsedAmount, summary]);

  const validationError = useMemo(() => {
    try {
      const value = parseTokenAmount(amount);
      if (value === 0n) {
        return "Enter an amount";
      }

      if (!account) {
        return "Connect a wallet";
      }

      if (!balances || !summary) {
        return "Loading vault data";
      }

      if (mode === "supply" && value > balances.quote) {
        return `Insufficient ${DEEPBOOK_PREDICT.quote.symbol}`;
      }

      if (mode === "withdraw" && value > balances.plp) {
        return `Insufficient ${DEEPBOOK_PREDICT.plp.symbol}`;
      }

      if (mode === "withdraw" && estimatedOutput > summary.availableWithdrawal) {
        return "Requested withdrawal exceeds available liquidity";
      }

      return null;
    } catch (caughtError) {
      return caughtError instanceof Error
        ? caughtError.message
        : "Enter a valid amount";
    }
  }, [account, amount, balances, estimatedOutput, mode, summary]);

  async function loadVaultData() {
    setIsLoading(true);
    setError(null);

    try {
      const nextSummary = await getVaultSummary(client, account?.address);
      setSummary(nextSummary);

      if (account) {
        setBalances(await getWalletVaultBalances(client, account.address));
      } else {
        setBalances(null);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load vault data",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadVaultData();
  }, [account?.address, client]);

  async function submitLiquidityAction() {
    if (!account || parsedAmount === null || validationError) {
      return;
    }

    setError(null);
    setTxDigest(null);

    try {
      const transaction =
        mode === "supply"
          ? createSupplyTransaction(parsedAmount, account.address)
          : createWithdrawTransaction(parsedAmount, account.address);

      const result = await signAndExecuteTransaction({
        transaction,
        chain: "sui:testnet",
      });

      setTxDigest(result.digest);
      setAmount("");
      await loadVaultData();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Transaction failed",
      );
    }
  }

  const inputSymbol =
    mode === "supply" ? DEEPBOOK_PREDICT.quote.symbol : DEEPBOOK_PREDICT.plp.symbol;
  const outputSymbol =
    mode === "supply" ? DEEPBOOK_PREDICT.plp.symbol : DEEPBOOK_PREDICT.quote.symbol;
  const maxAmount =
    mode === "supply" ? balances?.quote ?? 0n : balances?.plp ?? 0n;

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Vault Actions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Supply {DEEPBOOK_PREDICT.quote.symbol} liquidity or withdraw by
              burning {DEEPBOOK_PREDICT.plp.symbol} shares.
            </p>
          </div>
          <ConnectButton />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Vault balance" value={summary ? formatTokenAmount(summary.totalBalance) : "-"} />
          <Metric label="Vault value" value={summary ? formatTokenAmount(summary.vaultValue) : "-"} />
          <Metric label="Available withdrawal" value={summary ? formatTokenAmount(summary.availableWithdrawal) : "-"} />
          <Metric label="PLP supply" value={summary ? formatTokenAmount(summary.totalPlpSupply) : "-"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <Tabs value={mode} onValueChange={(value) => setMode(value as VaultMode)}>
                <TabsList aria-label="Vault action">
                  <TabsTrigger value="supply">Supply</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                </TabsList>
              </Tabs>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
                onClick={() => void loadVaultData()}
                type="button"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Refresh
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="vault-amount">
                Amount
              </label>
              <div className="flex overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-lg outline-none"
                  id="vault-amount"
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.0"
                  value={amount}
                />
                <div className="flex items-center gap-2 border-l border-border px-3 text-sm font-medium">
                  {inputSymbol}
                </div>
              </div>
              <button
                className="self-start text-xs text-muted-foreground hover:text-foreground"
                disabled={!balances}
                onClick={() => setAmount(formatTokenAmount(maxAmount))}
                type="button"
              >
                Balance {formatTokenAmount(maxAmount)} {inputSymbol}
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Estimated output</span>
                <span className="font-mono">
                  {formatTokenAmount(estimatedOutput)} {outputSymbol}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Connected wallet</span>
                <span className="font-mono">
                  {account ? truncateAddress(account.address) : "Not connected"}
                </span>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {txDigest ? (
              <a
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                href={getSuiExplorerTxUrl(txDigest)}
                rel="noreferrer"
                target="_blank"
              >
                View transaction <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : null}

            <button
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending || Boolean(validationError)}
              onClick={() => void submitLiquidityAction()}
              type="button"
            >
              {mode === "supply" ? (
                <ArrowDownToLine className="size-4" aria-hidden="true" />
              ) : (
                <ArrowUpFromLine className="size-4" aria-hidden="true" />
              )}
              {isPending ? "Waiting for wallet" : validationError ?? (mode === "supply" ? "Supply Liquidity" : "Withdraw Liquidity")}
            </button>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold">Position In Vault</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label={`${DEEPBOOK_PREDICT.quote.symbol} balance`} value={`${formatTokenAmount(balances?.quote ?? 0n)} ${DEEPBOOK_PREDICT.quote.symbol}`} />
              <Metric label={`${DEEPBOOK_PREDICT.plp.symbol} balance`} value={`${formatTokenAmount(balances?.plp ?? 0n)} ${DEEPBOOK_PREDICT.plp.symbol}`} />
              <Metric label="Max payout coverage" value={summary ? formatTokenAmount(summary.totalMaxPayout) : "-"} />
              <Metric label="Mark-to-market liability" value={summary ? formatTokenAmount(summary.totalMtm) : "-"} />
            </div>
            <div className="mt-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Accepted quote asset:{" "}
              <span className="font-mono text-foreground break-all">
                {DEEPBOOK_PREDICT.quote.type}
              </span>
            </div>
            {isLoading ? (
              <div className="mt-4 text-sm text-muted-foreground">Loading vault data...</div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}
