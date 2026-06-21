import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { loadMakerStubPrivateKey } from "./config";

describe("maker signing config", () => {
  it("loads the maker stub private key from the worker environment", () => {
    assert.equal(
      loadMakerStubPrivateKey({ MAKER_STUB_PRIVATE_KEY: "  suiprivkey-test  " }),
      "suiprivkey-test",
    );
  });

  it("rejects missing or empty private keys", () => {
    assert.throws(
      () => loadMakerStubPrivateKey({}),
      /MAKER_STUB_PRIVATE_KEY is not configured/,
    );
    assert.throws(
      () => loadMakerStubPrivateKey({ MAKER_STUB_PRIVATE_KEY: "   " }),
      /MAKER_STUB_PRIVATE_KEY is not configured/,
    );
  });
});
