// @vitest-environment node
// spec: packages/frontend/src/wallet/README.md "E2E test wallet"

import { describe, expect, it } from "vitest";
import {
  Account,
  hash,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { E2E_WALLET_ID, e2eWalletModule } from "./e2eWallet";

const key = Keypair.random();
const on = { DEV: true, VITE_E2E_WALLET: "1", E2E_WALLET_SECRET: key.secret() };

describe("e2eWalletModule", () => {
  it("is absent without the flag", () => {
    expect(
      e2eWalletModule(
        { ...on, VITE_E2E_WALLET: undefined },
        Networks.STANDALONE,
      ),
    ).toBeUndefined();
    expect(
      e2eWalletModule({ ...on, VITE_E2E_WALLET: "" }, Networks.STANDALONE),
    ).toBeUndefined();
  });

  it("is absent outside a dev build", () => {
    expect(
      e2eWalletModule({ ...on, DEV: false }, Networks.STANDALONE),
    ).toBeUndefined();
    expect(
      e2eWalletModule({ ...on, DEV: undefined }, Networks.STANDALONE),
    ).toBeUndefined();
  });

  it("refuses the flag without a secret", () => {
    expect(() =>
      e2eWalletModule(
        { ...on, E2E_WALLET_SECRET: undefined },
        Networks.STANDALONE,
      ),
    ).toThrow(/E2E_WALLET_SECRET/);
  });

  it("is absent with a foreign passphrase", () => {
    for (const p of [Networks.TESTNET, Networks.PUBLIC, Networks.FUTURENET, ""])
      expect(e2eWalletModule(on, p)).toBeUndefined();
  });

  it("signs transactions and SEP-53 messages with the run's key on standalone only", async () => {
    const m = e2eWalletModule(on, Networks.STANDALONE)!;
    expect(m.productId).toBe(E2E_WALLET_ID);
    expect(await m.getAddress()).toEqual({ address: key.publicKey() });

    const tx = new TransactionBuilder(new Account(key.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.STANDALONE,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
      .setTimeout(60)
      .build();
    const { signedTxXdr } = await m.signTransaction(tx.toXDR(), {
      networkPassphrase: Networks.STANDALONE,
    });
    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.STANDALONE);
    expect(key.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(
      true,
    );

    const { signedMessage } = await m.signMessage("challenge");
    const digest = hash(Buffer.from("Stellar Signed Message:\nchallenge"));
    expect(key.verify(digest, Buffer.from(signedMessage, "base64"))).toBe(true);

    await expect(
      m.signTransaction(tx.toXDR(), { networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: -3 });
    await expect(
      m.signMessage("x", { networkPassphrase: Networks.PUBLIC }),
    ).rejects.toMatchObject({ code: -3 });
  });
});
