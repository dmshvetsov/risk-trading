import { createNetworkConfig } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

type SuiNetwork = "mainnet" | "testnet" | "localnet";

const network = envVar("VITE_SUI_NETWORK") as SuiNetwork;
const networkConfig =
  network === "mainnet"
    ? createNetworkConfig({
        mainnet: {
          network: "mainnet",
          url: getJsonRpcFullnodeUrl("mainnet"),
        },
      })
    : network === "testnet"
      ? createNetworkConfig({
          testnet: {
            network: "testnet",
            url: getJsonRpcFullnodeUrl("testnet"),
          },
        })
      : network === "localnet"
        ? createNetworkConfig({
            localnet: {
              network: "localnet",
              url: getJsonRpcFullnodeUrl("localnet"),
            },
          })
        : undefined;

if (!network) {
  throw new Error("Invalid network configuration");
}

export const appConfig = {
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
