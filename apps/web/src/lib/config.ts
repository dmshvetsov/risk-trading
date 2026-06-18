export type AppNetwork = "mainnet" | "testnet";

function getDefaultNetworkName(): AppNetwork {
  return import.meta.env.VITE_SUI_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

export const appConfig = {
  network: getDefaultNetworkName(),
  rfqApiUrl: import.meta.env.VITE_RFQ_API_URL ?? "http://localhost:8787",
  broadcastApiUrl:
    import.meta.env.VITE_BROADCAST_API_URL ?? "http://localhost:8788",
  supportedAssets: [
    {
      symbol: "BTC / USDC",
      step: "0.05 BTC",
      feed: "Crypto.BTC/USD",
      payoutHint: "Earn cash upfront when you lock BTC for a chosen date.",
    },
  ],
};
