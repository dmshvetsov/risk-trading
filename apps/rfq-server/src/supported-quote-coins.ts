export const supportedQuoteCoins = [
  {
    // Localnet uses a custom development USDC package id published per environment.
    coinType: "0x0::usdc::USDC",
    network: "localnet",
    symbol: "USDC",
  },
  {
    coinType:
      "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    network: "testnet",
    symbol: "USDC",
  },
  {
    coinType:
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    network: "mainnet",
    symbol: "USDC",
  },
] as const;
