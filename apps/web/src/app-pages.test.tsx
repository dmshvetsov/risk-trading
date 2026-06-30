import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";

import { AppChrome } from "./components/app-shell";
import { HomePage, UnderwriteProgress } from "./pages/home-page";
import { MakerVaultCardView, MakerVaultsView } from "./pages/maker-vaults-page";
import { SharedStatesPage } from "./pages/shared-states-page";
import {
  quantityToContractsQtyDecimals,
  quotePremiumTotal,
  quoteQueryOptions,
  quoteTerms,
  requestQuote,
  secondsUntilExpiry,
} from "./lib/quote-request";
import {
  expiryOptionsFromSeries,
  seriesGridQueryOptions,
  strikeOptionsForExpiry,
  type SeriesGrid,
} from "./lib/series-grid";
import { fetchBtcUsdPythPrice } from "./lib/oracle";
import { SuiProviders } from "./components/sui-providers";
import { getRouter } from "./router";
import { appConfig } from "./lib/config";

const testSeriesGrid = {
  market: {
    baseDecimals: 8,
    baseCoinType: "0x0::test_btc::TEST_BTC",
    marketId: "0xmarket",
    oracleBaseSymbol: "BTC",
    oracleFeedId: "0xfeed",
    oracleQuoteSymbol: "USDC",
    quoteDecimals: 6,
    quoteCoinType: "0x0::usdc::USDC",
    strikeScale: 1_000_000,
  },
  spot: {
    price: 67_234.56,
    publishTime: 1_781_000_000,
    symbol: "BTC",
  },
  series: {
    call: [
      {
        expiryUnixMs: Date.UTC(2026, 6, 31, 8),
        seriesId: "0xcall-jul31-70000",
        strikePriceDecimals: "70000000000",
      },
      {
        expiryUnixMs: Date.UTC(2026, 6, 31, 8),
        seriesId: "0xcall-jul31-71000",
        strikePriceDecimals: "71000000000",
      },
      {
        expiryUnixMs: Date.UTC(2026, 7, 7, 8),
        seriesId: "0xcall-aug7-72000",
        strikePriceDecimals: "72000000000",
      },
    ],
    put: [
      {
        expiryUnixMs: Date.UTC(2026, 6, 31, 8),
        seriesId: "0xput-jul31-65000",
        strikePriceDecimals: "65000000000",
      },
      {
        expiryUnixMs: Date.UTC(2026, 6, 31, 8),
        seriesId: "0xput-jul31-64000",
        strikePriceDecimals: "64000000000",
      },
    ],
  },
} satisfies SeriesGrid;

describe("App pages", () => {
  it("renders the home route at slash", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/"],
      }),
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(seriesGridQueryOptions(appConfig.rfqApiUrl).queryKey, testSeriesGrid);

    await testRouter.load();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <RouterProvider router={testRouter} />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Earn Upfront Yield/i);
    assert.match(html, /deposit 0\.05 WBTC as collateral/i);
    assert.match(html, /CONNECT WALLET TO EARN/i);
  });

  it("shows global marketing navigation and auth button copy", () => {
    const html = renderToStaticMarkup(
      <AppChrome
        currentPath="/maker"
        walletLabel="Wallet not connected"
        showWalletButton={false}
        usePlainLinks
      >
        <div>Route content</div>
      </AppChrome>,
    );

    assert.match(html, /Earn/);
    assert.match(html, /Dashboard/);
    assert.doesNotMatch(html, /Maker shell|Maker dashboard|Shared states/);
    assert.match(html, /Docs/);
    assert.match(html, /Route content/);
  });
});

describe("Taker copy", () => {
  it("shows pending and confirmed earning states", () => {
    assert.match(renderToStaticMarkup(<UnderwriteProgress status="queued" />), /transaction is pending/i);
    assert.match(renderToStaticMarkup(<UnderwriteProgress status="confirmed" />), /earnings are confirmed/i);
  });

  it("keeps the home page free of option jargon", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(seriesGridQueryOptions(appConfig.rfqApiUrl).queryKey, testSeriesGrid);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <HomePage usePlainLink />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.doesNotMatch(html, /option|derivative/i);
    assert.match(html, /deposit 0\.05 WBTC as collateral/i);
  });

  it("renders server-provided expiries and strikes on the home page", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(seriesGridQueryOptions(appConfig.rfqApiUrl).queryKey, testSeriesGrid);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <HomePage usePlainLink />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Jul 31/);
    assert.match(html, /\$70,000/);
    assert.match(html, /\$71,000/);
    assert.match(html, /WBTC.*\$67,234\.56/s);
  });

  it("maps selected server buckets into local expiry and strike labels", () => {
    const callSeries = testSeriesGrid.series.call;
    const expiries = expiryOptionsFromSeries(callSeries);
    const strikes = strikeOptionsForExpiry(
      callSeries,
      Date.UTC(2026, 6, 31, 8),
      testSeriesGrid.market.strikeScale,
    );

    assert.deepEqual(expiries, [
      { expiryUnixMs: Date.UTC(2026, 6, 31, 8), label: "Jul 31" },
      { expiryUnixMs: Date.UTC(2026, 7, 7, 8), label: "Aug 7" },
    ]);
    assert.deepEqual(strikes.map((strike) => ({
      label: strike.label,
      seriesId: strike.seriesId,
      strikePriceDecimals: strike.strikePriceDecimals,
    })), [
      {
        label: "$70,000",
        seriesId: "0xcall-jul31-70000",
        strikePriceDecimals: "70000000000",
      },
      {
        label: "$71,000",
        seriesId: "0xcall-jul31-71000",
        strikePriceDecimals: "71000000000",
      },
    ]);
  });

  it("reduces the quote countdown as time passes", () => {
    assert.equal(secondsUntilExpiry(31_000, 1_000), 30);
    assert.equal(secondsUntilExpiry(31_000, 11_000), 20);
    assert.equal(secondsUntilExpiry(31_000, 41_000), 0);
  });

  it("sends the supported market request to RFQ and maps its quote", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const quote = await requestQuote(
      "https://rfq.example",
      testSeriesGrid.market,
      "covered-call",
      {
        expiryUnixMs: 1_800_000_000_000,
        size: 0.05,
        strikePriceDecimals: "6800000000000",
      },
      async (input, init) => {
        requests.push({ input, init });
        return Response.json({ quote_signature: "quote-signature", quote: {
          cash_premium_per_contract: "1263800000", cash_token_decimals: 6,
          collateral_token_decimals: 8, expiry_unix_ms: 1_800_000_000_000,
          offer_valid_until_total_contracts_qty_decimals: "99000000",
          offer_valid_until_unix_ms: 1_799_000_000_000,
          strike_price_decimals: "6800000000000",
        }});
      },
    );

    assert.equal(requests[0]?.input, "https://rfq.example/api/quotes");
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.request.oracle_feed_id, testSeriesGrid.market.oracleFeedId);
    assert.equal(body.request.cash_token_address, testSeriesGrid.market.quoteCoinType);
    assert.equal(body.request.cash_token_decimals, testSeriesGrid.market.quoteDecimals);
    assert.equal(body.request.collateral_token_address, testSeriesGrid.market.baseCoinType);
    assert.equal(body.request.collateral_token_decimals, testSeriesGrid.market.baseDecimals);
    assert.equal(body.request.contracts_qty_decimals, "5000000");
    assert.equal(body.request.strike_price_decimals, "6800000000000");
    assert.equal(quote.contractsQtyDecimals, "5000000");
    assert.equal(quote.cashPremiumPerContract, "1263800000");
    assert.equal(quote.quoteSignature, "quote-signature");
  });

  it("uses the shared request path with cash collateral for puts", async () => {
    let body: { request: Record<string, unknown> } | undefined;
    await requestQuote(
      "https://rfq.example",
      testSeriesGrid.market,
      "cash-secured-put",
      {
        expiryUnixMs: 1_800_000_000_000,
        size: 0.05,
        strikePriceDecimals: "6800000000000",
      },
      async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ quote_signature: "quote-signature", quote: {
          cash_premium_per_contract: "1000000000", cash_token_decimals: 6,
          collateral_token_decimals: 6, expiry_unix_ms: 1_800_000_000_000,
          offer_valid_until_total_contracts_qty_decimals: "3400000000",
          offer_valid_until_unix_ms: 1_799_000_000_000,
          strike_price_decimals: "6800000000000",
        }});
      },
    );

    assert.equal(body?.request.call_put_marker, 2);
    assert.equal(body?.request.collateral_token_address, testSeriesGrid.market.quoteCoinType);
    assert.equal(body?.request.collateral_token_decimals, testSeriesGrid.market.quoteDecimals);
    assert.equal(body?.request.contracts_qty_decimals, "5000000");
  });

  it("treats null quote payloads as unavailable", async () => {
    const quote = await requestQuote(
      "https://rfq.example",
      testSeriesGrid.market,
      "covered-call",
      {
        expiryUnixMs: 1_800_000_000_000,
        size: 0.05,
        strikePriceDecimals: "6800000000000",
      },
      async () => Response.json({ quote: null, quote_signature: null }),
    );

    assert.equal(quote, null);
  });

  it("keys and caches quote requests through React Query", async () => {
    const queryClient = new QueryClient();
    const request = async () => Response.json({ quote_signature: "quote-signature", quote: {
      cash_premium_per_contract: "1263800000", cash_token_decimals: 6,
      collateral_token_decimals: 8, expiry_unix_ms: 1_800_000_000_000,
      offer_valid_until_total_contracts_qty_decimals: "5000000",
      offer_valid_until_unix_ms: 1_799_000_000_000,
      strike_price_decimals: "68000000000",
    }});
    const inputs = {
      expiryUnixMs: 1_800_000_000_000,
      size: 0.05,
      strikePriceDecimals: "6800000000000",
    };
    const options = quoteQueryOptions(
      "https://rfq.example",
      testSeriesGrid.market,
      "covered-call",
      inputs,
      request,
    );

    const quote = await queryClient.fetchQuery(options);
    const putOptions = quoteQueryOptions(
      "https://rfq.example",
      testSeriesGrid.market,
      "cash-secured-put",
      inputs,
      request,
    );

    assert.equal(quote.cashPremiumPerContract, "1263800000");
    assert.deepEqual(queryClient.getQueryData(options.queryKey), quote);
    assert.notDeepEqual(options.queryKey, putOptions.queryKey);
  });

  it("reads the BTC price from Pyth parsed updates", async () => {
    let requestedUrl = "";
    const price = await fetchBtcUsdPythPrice(async (input) => {
      requestedUrl = input.toString();
      return Response.json({
        parsed: [{
          id: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
          price: {
            price: "6218683982020",
            expo: -8,
            publish_time: 1782211502,
          },
        }],
      });
    });

    assert.match(requestedUrl, /hermes\.pyth\.network/);
    assert.match(requestedUrl, /parsed=true/);
    assert.equal(price.price, 62_186.8398202);
    assert.equal(price.publishTime, 1_782_211_502);
  });

  it("encodes contracts quantity in base coin decimals", () => {
    assert.equal(quantityToContractsQtyDecimals(0.005), "500000");
    assert.equal(quantityToContractsQtyDecimals(0.05), "5000000");
    assert.equal(quantityToContractsQtyDecimals(1), "100000000");
  });

  it("calculates total premium from per-1-BTC quote units", () => {
    assert.equal(quotePremiumTotal("1220000000", "5000000", 8, 6), 61);
  });

  it("calculates put cash collateral and above/below-strike outcomes", () => {
    assert.deepEqual(quoteTerms("cash-secured-put", 0.05, 68_000), {
      collateralAmount: 3_400,
      collateralSymbol: "USDC",
      downsideAmount: 0.05,
      downsideSymbol: "WBTC",
      upsideAmount: 3_400,
      upsideSymbol: "USDC",
    });
  });

  it("renders not found for the removed taker route", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/taker"],
      }),
    );
    const queryClient = new QueryClient();

    await testRouter.load();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <RouterProvider router={testRouter} />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Page not found/);
  });
});

describe("Maker copy", () => {
  it("renders the connected maker create-vault form", () => {
    const html = renderToStaticMarkup(
      <MakerVaultsView
        accountAddress="0xmaker"
        isLoading={false}
        supportedCoins={[
          {
            coinType:
              "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
            network: "testnet",
            symbol: "USDC",
          },
        ]}
        vaults={[]}
      />,
    );

    assert.match(html, /Create vault/);
    assert.match(html, /Quote endpoint URL/);
    assert.match(html, /Order endpoint URL/);
    assert.match(html, /USDC/);
  });

  it("renders vault state, edit controls, and close action on the vaults tab", () => {
    const html = renderToStaticMarkup(
      <MakerVaultCardView
        vault={{
          balance: "250.00 USDC",
          enabled: true,
          orderEndpointUrl: "https://maker.example/orders",
          quoteCoinSymbol: "USDC",
          quoteCoinType:
            "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
          quoteEndpointUrl: "https://maker.example/quotes",
          vaultId: "0xvault-1",
        }}
        quoteEndpointUrl="https://maker.example/quotes"
        orderEndpointUrl="https://maker.example/orders"
        closeVaultDigest=""
        onQuoteEndpointUrlChange={() => undefined}
        onOrderEndpointUrlChange={() => undefined}
        onCloseVaultDigestChange={() => undefined}
        onUpdateEndpoints={() => undefined}
        onSubmitCloseDigest={() => undefined}
      />,
    );

    assert.match(html, /250.00 USDC/);
    assert.match(html, /Save vault endpoints/);
    assert.match(html, /Submit close digest/);
    assert.match(html, /Ready for RFQs/);
  });

  it("renders the hidden maker route on direct visit", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/maker"],
      }),
    );
    const queryClient = new QueryClient();

    await testRouter.load();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <RouterProvider router={testRouter} />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Maker Dashboard/);
    assert.match(html, /\/maker\/vaults/);
    assert.match(html, /\/maker\/positions/);
  });
});

describe("Shared states", () => {
  it("shows reusable loading and error patterns", () => {
    const html = renderToStaticMarkup(<SharedStatesPage />);

    assert.match(html, /Loading boundaries are wired/i);
    assert.match(html, /Shared recovery state/i);
  });
});
