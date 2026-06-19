import { type ReactNode, useState } from "react";
import {
  useCurrentAccount,
  useSignPersonalMessage,
  useSignTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { appConfig } from "../lib/config";

type SupportedCoin = {
  coinType: string;
  network: string;
  symbol: string;
};

type MakerVaultApiRecord = {
  enabled: boolean;
  orderEndpointUrl: string | null;
  quoteCoinSymbol: string;
  quoteCoinType: string;
  quoteEndpointUrl: string | null;
  vaultId: string;
};

type MakerVaultRecord = MakerVaultApiRecord & {
  balance: string;
};

function formatAmount(rawAmount: string, symbol: string) {
  if (!/^\d+$/.test(rawAmount)) {
    return `Unavailable ${symbol}`;
  }

  const decimals = symbol === "USDC" ? 6 : 0;
  const amount = Number(rawAmount) / 10 ** decimals;

  if (!Number.isFinite(amount)) {
    return `Unavailable ${symbol}`;
  }

  return `${amount.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 2,
  })} ${symbol}`;
}

function readBalanceValue(input: unknown): string | null {
  if (typeof input === "string" && /^\d+$/.test(input)) {
    return input;
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;

  return (
    readBalanceValue(record.balance) ??
    readBalanceValue(record.value) ??
    readBalanceValue(record.fields)
  );
}

async function fetchSupportedCoins() {
  const response = await fetch(`${appConfig.rfqApiUrl}/api/maker/supported-coins`);

  if (!response.ok) {
    throw new Error("Failed to load supported quote coins");
  }

  const payload = (await response.json()) as { supportedCoins: SupportedCoin[] };
  return payload.supportedCoins;
}

async function fetchMakerVaults(ownerAddress: string) {
  const response = await fetch(
    `${appConfig.rfqApiUrl}/api/maker/vaults?ownerAddress=${encodeURIComponent(ownerAddress)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to load maker vaults");
  }

  const payload = (await response.json()) as { vaults: MakerVaultApiRecord[] };
  return payload.vaults;
}

async function fetchVaultBalances(
  client: ReturnType<typeof useSuiClient>,
  vaults: MakerVaultApiRecord[],
) {
  const objects = await Promise.all(
    vaults.map((vault) =>
      client.getObject({
        id: vault.vaultId,
        options: { showContent: true },
      }),
    ),
  );

  return vaults.map((vault, index) => {
    const object = objects[index];
    const balanceValue = readBalanceValue(object.data?.content);

    return {
      ...vault,
      balance: balanceValue
        ? formatAmount(balanceValue, vault.quoteCoinSymbol)
        : `Unavailable ${vault.quoteCoinSymbol}`,
    };
  });
}

export function buildCreateVaultTransaction(packageId: string, quoteCoinType: string) {
  const transaction = new Transaction();
  transaction.moveCall({
    target: `${packageId}::buyer_vault::create_vault`,
    typeArguments: [quoteCoinType],
  });
  return transaction;
}

export function CreateMakerVaultFormView({
  isPending = false,
  onOrderEndpointUrlChange = () => undefined,
  onQuoteCoinTypeChange = () => undefined,
  onQuoteEndpointUrlChange = () => undefined,
  onSubmit = () => undefined,
  orderEndpointUrl = "",
  quoteCoinType,
  quoteEndpointUrl = "",
  supportedCoins,
}: {
  isPending?: boolean;
  onOrderEndpointUrlChange?: (value: string) => void;
  onQuoteCoinTypeChange?: (value: string) => void;
  onQuoteEndpointUrlChange?: (value: string) => void;
  onSubmit?: () => void;
  orderEndpointUrl?: string;
  quoteCoinType?: string;
  quoteEndpointUrl?: string;
  supportedCoins: SupportedCoin[];
}) {
  return (
    <form
      className="grid gap-3 border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className="text-sm font-medium">Create vault</p>
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Quote coin</span>
        <select
          className="border border-input bg-background px-3 py-2"
          value={quoteCoinType ?? supportedCoins[0]?.coinType ?? ""}
          onChange={(event) => onQuoteCoinTypeChange(event.target.value)}
        >
          {supportedCoins.map((coin) => (
            <option key={coin.coinType} value={coin.coinType}>
              {coin.symbol}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Quote endpoint URL</span>
        <input
          className="border border-input bg-background px-3 py-2"
          onChange={(event) => onQuoteEndpointUrlChange(event.target.value)}
          placeholder="https://maker.example/quotes"
          required
          type="url"
          value={quoteEndpointUrl}
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Order endpoint URL</span>
        <input
          className="border border-input bg-background px-3 py-2"
          onChange={(event) => onOrderEndpointUrlChange(event.target.value)}
          placeholder="https://maker.example/orders"
          required
          type="url"
          value={orderEndpointUrl}
        />
      </label>
      <Button disabled={isPending || supportedCoins.length === 0} type="submit">
        {isPending ? "Waiting for wallet..." : "Sign and create vault"}
      </Button>
    </form>
  );
}

function CreateMakerVaultForm({
  accountAddress,
  supportedCoins,
}: {
  accountAddress: string;
  supportedCoins: SupportedCoin[];
}) {
  const queryClient = useQueryClient();
  const signTransaction = useSignTransaction();
  const [quoteCoinType, setQuoteCoinType] = useState("");
  const [quoteEndpointUrl, setQuoteEndpointUrl] = useState("");
  const [orderEndpointUrl, setOrderEndpointUrl] = useState("");
  const selectedCoinType = quoteCoinType || supportedCoins[0]?.coinType || "";

  const createVault = useMutation({
    mutationFn: async () => {
      if (!appConfig.otpPackageId || !selectedCoinType) {
        throw new Error("Vault package or quote coin is not configured");
      }
      const transaction = buildCreateVaultTransaction(
        appConfig.otpPackageId,
        selectedCoinType,
      );
      const signed = await signTransaction.mutateAsync({ transaction });
      const response = await fetch(
        `${appConfig.rfqApiUrl}/api/maker/vaults/submissions`,
        {
          body: JSON.stringify({
            orderEndpointUrl,
            ownerAddress: accountAddress,
            quoteCoinType: selectedCoinType,
            quoteEndpointUrl,
            signature: signed.signature,
            transactionBytes: signed.bytes,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to submit create vault transaction");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["maker-vaults", accountAddress],
      });
    },
  });

  return (
    <CreateMakerVaultFormView
      isPending={createVault.isPending}
      onOrderEndpointUrlChange={setOrderEndpointUrl}
      onQuoteCoinTypeChange={setQuoteCoinType}
      onQuoteEndpointUrlChange={setQuoteEndpointUrl}
      onSubmit={() => void createVault.mutateAsync()}
      orderEndpointUrl={orderEndpointUrl}
      quoteCoinType={selectedCoinType}
      quoteEndpointUrl={quoteEndpointUrl}
      supportedCoins={supportedCoins}
    />
  );
}

export function MakerVaultCard({
  accountAddress,
  vault,
}: {
  accountAddress: string | null;
  vault: MakerVaultRecord;
}) {
  const queryClient = useQueryClient();
  const signPersonalMessage = useSignPersonalMessage();
  const [quoteEndpointUrl, setQuoteEndpointUrl] = useState(vault.quoteEndpointUrl ?? "");
  const [orderEndpointUrl, setOrderEndpointUrl] = useState(vault.orderEndpointUrl ?? "");
  const [closeVaultDigest, setCloseVaultDigest] = useState("");

  const updateEndpoints = useMutation({
    mutationFn: async () => {
      if (!accountAddress) {
        throw new Error("Connect the maker wallet first");
      }

      const message = `otp:maker-config:v1:${vault.vaultId}`;
      const signature = await signPersonalMessage.mutateAsync({
        message: new TextEncoder().encode(message),
      });

      const response = await fetch(
        `${appConfig.rfqApiUrl}/api/maker/vaults/${encodeURIComponent(vault.vaultId)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            quoteEndpointUrl,
            orderEndpointUrl,
            ownerProof: {
              message,
              ownerAddress: accountAddress,
              signature: signature.signature,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to update maker endpoints");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["maker-vaults", accountAddress],
      });
    },
  });

  const submitCloseDigest = useMutation({
    mutationFn: async () => {
      if (!accountAddress) {
        throw new Error("Connect the maker wallet first");
      }

      const response = await fetch(
        `${appConfig.rfqApiUrl}/api/maker/vaults/${encodeURIComponent(vault.vaultId)}/close`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ownerAddress: accountAddress,
            closeVaultDigest,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to submit close digest");
      }
    },
    onSuccess: async () => {
      setCloseVaultDigest("");
      await queryClient.invalidateQueries({
        queryKey: ["maker-vaults", accountAddress],
      });
    },
  });

  return (
    <MakerVaultCardView
      vault={vault}
      quoteEndpointUrl={quoteEndpointUrl}
      orderEndpointUrl={orderEndpointUrl}
      closeVaultDigest={closeVaultDigest}
      onQuoteEndpointUrlChange={setQuoteEndpointUrl}
      onOrderEndpointUrlChange={setOrderEndpointUrl}
      onCloseVaultDigestChange={setCloseVaultDigest}
      onUpdateEndpoints={() => void updateEndpoints.mutateAsync()}
      onSubmitCloseDigest={() => void submitCloseDigest.mutateAsync()}
    />
  );
}

export function MakerVaultCardView({
  vault,
  quoteEndpointUrl,
  orderEndpointUrl,
  closeVaultDigest,
  onQuoteEndpointUrlChange,
  onOrderEndpointUrlChange,
  onCloseVaultDigestChange,
  onUpdateEndpoints,
  onSubmitCloseDigest,
}: {
  vault: MakerVaultRecord;
  quoteEndpointUrl: string;
  orderEndpointUrl: string;
  closeVaultDigest: string;
  onQuoteEndpointUrlChange: (value: string) => void;
  onOrderEndpointUrlChange: (value: string) => void;
  onCloseVaultDigestChange: (value: string) => void;
  onUpdateEndpoints: () => void;
  onSubmitCloseDigest: () => void;
}) {
  return (
    <Card className="bg-muted/20">
      <CardContent className="grid gap-5 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <p className="text-sm font-medium">{vault.quoteCoinSymbol} vault</p>
            <p className="break-all text-xs text-muted-foreground">{vault.vaultId}</p>
          </div>
          <span className="border border-border px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {vault.enabled ? "Ready for RFQs" : "Disabled"}
          </span>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Balance
            </dt>
            <dd>{vault.balance}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Quote coin
            </dt>
            <dd>{vault.quoteCoinSymbol}</dd>
          </div>
        </dl>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onUpdateEndpoints();
          }}
        >
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Edit endpoints
          </p>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Quote endpoint URL</span>
            <input
              className="border border-input bg-background px-3 py-2"
              value={quoteEndpointUrl}
              onChange={(event) => onQuoteEndpointUrlChange(event.target.value)}
              placeholder="https://maker.example/quotes"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Order endpoint URL</span>
            <input
              className="border border-input bg-background px-3 py-2"
              value={orderEndpointUrl}
              onChange={(event) => onOrderEndpointUrlChange(event.target.value)}
              placeholder="https://maker.example/orders"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary">
              Save vault endpoints
            </Button>
            <span className="text-xs text-muted-foreground">
              Uses a wallet-signed owner proof before RFQ updates stored URLs.
            </span>
          </div>
        </form>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitCloseDigest();
          }}
        >
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Close vault
          </p>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Signed close_vault digest</span>
            <input
              className="border border-input bg-background px-3 py-2"
              value={closeVaultDigest}
              onChange={(event) => onCloseVaultDigestChange(event.target.value)}
              placeholder="Paste the close_vault transaction digest"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline">
              Submit close digest
            </Button>
            <span className="text-xs text-muted-foreground">
              After the wallet signs and broadcasts close_vault, submit the digest here.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function MakerVaultsView({
  accountAddress,
  createVaultForm,
  isLoading,
  supportedCoins,
  vaults,
}: {
  accountAddress: string | null;
  createVaultForm?: ReactNode;
  isLoading: boolean;
  supportedCoins: SupportedCoin[];
  vaults: MakerVaultRecord[];
}) {
  const supportedCoinSummary =
    supportedCoins.length > 0
      ? supportedCoins.map((coin) => coin.symbol).join(", ")
      : "Loading";

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Vaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <p>RFQ metadata comes from the server database.</p>
            <p>Balances are read from chain in the web app.</p>
            <p>Supported quote coins: {supportedCoinSummary}</p>
          </div>

          {!accountAddress ? (
            <p className="text-sm text-muted-foreground">
              Connect the maker wallet to load vault state, balances, and endpoint actions.
            </p>
          ) : null}

          {accountAddress
            ? createVaultForm ?? (
                <CreateMakerVaultFormView supportedCoins={supportedCoins} />
              )
            : null}

          {accountAddress && isLoading ? (
            <p className="text-sm text-muted-foreground">Loading maker vault state...</p>
          ) : null}

          {accountAddress && !isLoading && vaults.length === 0 ? (
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>No maker vaults are registered for this wallet yet.</p>
              <p>Supported quote coins: {supportedCoinSummary}</p>
            </div>
          ) : null}

          {accountAddress && !isLoading
            ? vaults.map((vault) => (
                <MakerVaultCard
                  key={vault.vaultId}
                  accountAddress={accountAddress}
                  vault={vault}
                />
              ))
            : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function MakerVaultsPage() {
  const account = useCurrentAccount();
  const client = useSuiClient();

  const supportedCoinsQuery = useQuery({
    queryKey: ["maker-supported-coins"],
    queryFn: fetchSupportedCoins,
  });

  const vaultsQuery = useQuery({
    queryKey: ["maker-vaults", account?.address ?? null],
    queryFn: () => fetchMakerVaults(account?.address ?? ""),
    enabled: Boolean(account?.address),
    refetchInterval: account?.address ? 3_000 : false,
  });

  const balancesQuery = useQuery({
    queryKey: [
      "maker-vault-balances",
      account?.address ?? null,
      (vaultsQuery.data ?? []).map((vault) => vault.vaultId).join(","),
    ],
    queryFn: () => fetchVaultBalances(client, vaultsQuery.data ?? []),
    enabled: Boolean(vaultsQuery.data && vaultsQuery.data.length > 0),
  });

  return (
    <MakerVaultsView
      accountAddress={account?.address ?? null}
      createVaultForm={
        account?.address ? (
          <CreateMakerVaultForm
            accountAddress={account.address}
            supportedCoins={(supportedCoinsQuery.data ?? []).filter(
              (coin) => coin.network === appConfig.network,
            )}
          />
        ) : null
      }
      isLoading={
        supportedCoinsQuery.isLoading ||
        vaultsQuery.isLoading ||
        balancesQuery.isLoading
      }
      supportedCoins={(supportedCoinsQuery.data ?? []).filter(
        (coin) => coin.network === appConfig.network,
      )}
      vaults={balancesQuery.data ?? []}
    />
  );
}

export default MakerVaultsPage;
