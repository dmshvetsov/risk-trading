import { createNetworkConfig } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

type SuiNetwork = "mainnet" | "testnet" | "localnet";

const network = envVar("VITE_SUI_NETWORK") as SuiNetwork;
const networkConfig = getNetworkConfig(network);

export const appConfig = {
  baseCoinType: getBaseCoinType(network),
  cashTokenAddress: getUsdcCoinType(network),
  networkConfig,
  network,
  otpPackageId: envVar("VITE_OTP_PACKAGE_ID"),
  rfqApiUrl: envVar("VITE_RFQ_API_URL"),
  strikeScale: Number(envVarOptional("VITE_MARKET_STRIKE_SCALE", "1000000")),
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
      return "0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC";
    case "mainnet":
      return "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
  }
}

function getBaseCoinType(networkName: SuiNetwork) {
  switch (networkName) {
    case "localnet":
      return "0x0::test_btc::TEST_BTC";
    case "testnet":
      return "0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e::test_btc::TEST_BTC";
    case "mainnet":
      return "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC";
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
