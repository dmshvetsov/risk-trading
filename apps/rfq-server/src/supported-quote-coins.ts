export const supportedQuoteCoins = [
  {
    // Localnet uses a custom development USDC package id published per environment.
    coinType: "0x0::usdc::USDC",
    network: "localnet",
    symbol: "USDC",
  },
  {
    coinType:
      "0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC",
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
