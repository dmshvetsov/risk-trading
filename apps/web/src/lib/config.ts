import { createNetworkConfig } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

type SuiNetwork = "mainnet" | "testnet" | "localnet";

const network = envVar("VITE_SUI_NETWORK") as SuiNetwork;
const networkConfig = getNetworkConfig(network);

export const appConfig = {
  cashTokenAddress: getUsdcCoinType(network),
  networkConfig,
  network,
  otpPackageId: envVar("VITE_OTP_PACKAGE_ID"),
  rfqApiUrl: envVar("VITE_RFQ_API_URL"),
  broadcastApiUrl: envVarOptional(
    "VITE_BROADCAST_API_URL",
    "http://localhost:8788",
  ),
  supportedAssets: [
    {
      symbol: "BTC / USDC",
      step: "0.05 BTC",
      feed: "Crypto.BTC/USD",
      payoutHint: "Earn cash upfront when you lock BTC for a chosen date.",
    },
  ],
};

function getUsdcCoinType(networkName: SuiNetwork) {
  switch (networkName) {
    case "localnet":
      return "0x0::usdc::USDC";
    case "testnet":
      return "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
    case "mainnet":
      return "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
  }
}

function envVar(key: string): string {
  const val = import.meta.env[key];
  if (!val) {
    throw new Error("Configuration error");
  }
  return val;
}

function envVarOptional(key: string, defaultVal: string): string {
  const val = import.meta.env[key];
  if (!val) {
    return defaultVal;
  }
  return val;
}

function getNetworkConfig(networkName: SuiNetwork) {
  switch (networkName) {
    case "mainnet":
      return createNetworkConfig({
        mainnet: {
          network: "mainnet",
          url: getJsonRpcFullnodeUrl("mainnet"),
        },
      }).networkConfig;
    case "testnet":
      return createNetworkConfig({
        testnet: {
          network: "testnet",
          url: getJsonRpcFullnodeUrl("testnet"),
        },
      }).networkConfig;
    case "localnet":
      return createNetworkConfig({
        localnet: {
          network: "localnet",
          url: getJsonRpcFullnodeUrl("localnet"),
        },
      }).networkConfig;
  }
}
