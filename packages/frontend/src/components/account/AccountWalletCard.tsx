// spec: docs/frontend/account-page.md#accountwalletcard
import { Button, CoinIcon, SegmentedTabs } from "@pipeline/ui";
import { useActiveWalletAccount } from "@/wallet";
import { AccountIconTile } from "./AccountIconTile";
import { AccountListRow } from "./AccountListRow";

const NAMESPACE_TABS = [
  { id: "evm", label: "Ethereum" },
  { id: "stellar", label: "Stellar" },
];

function WalletGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M26.6997 6C28.3799 6 29.2206 5.99968 29.8623 6.32666C30.4267 6.61426 30.8857 7.07332 31.1733 7.63769C31.5003 8.27943 31.5 9.12013 31.5 10.8003V12.75H27C24.1005 12.75 21.75 15.1005 21.75 18C21.75 20.8995 24.1005 23.25 27 23.25H31.5V25.1997C31.5 26.8799 31.5003 27.7206 31.1733 28.3623C30.8857 28.9267 30.4267 29.3857 29.8623 29.6733C29.2206 30.0003 28.3799 30 26.6997 30H9.30029C7.62013 30 6.77943 30.0003 6.13769 29.6733C5.57332 29.3857 5.11426 28.9267 4.82666 28.3623C4.49968 27.7206 4.5 26.8799 4.5 25.1997V10.8003C4.5 9.12013 4.49968 8.27943 4.82666 7.63769C5.11426 7.07332 5.57332 6.61426 6.13769 6.32666C6.77943 5.99968 7.62013 6 9.30029 6H26.6997Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M31.5 15C32.3284 15 33 15.6716 33 16.5V19.5C33 20.3284 32.3284 21 31.5 21H27C25.3431 21 24 19.6569 24 18C24 16.3431 25.3431 15 27 15H31.5ZM27 16.5C26.1716 16.5 25.5 17.1716 25.5 18C25.5 18.8284 26.1716 19.5 27 19.5C27.8284 19.5 28.5 18.8284 28.5 18C28.5 17.1716 27.8284 16.5 27 16.5Z"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 22 22"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M5.04167 12.6498C5.04167 13.1404 5.04063 13.5911 5.07121 13.9657C5.10313 14.3565 5.17655 14.7842 5.39168 15.2065C5.69927 15.8101 6.18991 16.3007 6.79354 16.6083C7.21576 16.8235 7.64352 16.8969 8.03426 16.9288C8.40888 16.9594 8.85965 16.9583 9.35018 16.9583H15.5806C15.5723 17.5771 15.5368 17.9488 15.3837 18.2492C15.208 18.5941 14.9274 18.8746 14.5825 19.0504C14.1903 19.2502 13.6766 19.25 12.6498 19.25H5.68351C4.65675 19.25 4.14299 19.2502 3.75081 19.0504C3.40592 18.8746 3.12538 18.5941 2.94963 18.2492C2.7498 17.857 2.75 17.3433 2.75 16.3165V9.35018C2.75 8.32342 2.7498 7.80965 2.94963 7.41748C3.12538 7.07258 3.40592 6.79205 3.75081 6.61629C4.05119 6.46324 4.42286 6.42684 5.04167 6.41846V12.6498Z" />
      <path d="M16.3165 2.75C17.3433 2.75 17.857 2.7498 18.2492 2.94963C18.5941 3.12538 18.8746 3.40592 19.0504 3.75081C19.2502 4.14299 19.25 4.65675 19.25 5.68351V12.6498C19.25 13.6766 19.2502 14.1903 19.0504 14.5825C18.8746 14.9274 18.5941 15.208 18.2492 15.3837C17.857 15.5835 17.3433 15.5833 16.3165 15.5833H9.35018C8.45184 15.5833 7.94647 15.5829 7.57145 15.4491L7.56519 15.4464C7.55386 15.4423 7.54227 15.4391 7.53117 15.4347L7.41748 15.3837L7.29126 15.313C7.00411 15.1369 6.77009 14.8843 6.61629 14.5825C6.41647 14.1903 6.41667 13.6766 6.41667 12.6498V5.68351C6.41667 4.65675 6.41647 4.14299 6.61629 3.75081C6.79205 3.40592 7.07258 3.12538 7.41748 2.94963C7.80965 2.7498 8.32342 2.75 9.35018 2.75H16.3165Z" />
    </svg>
  );
}

export function AccountWalletCard() {
  const {
    kind,
    setKind,
    isConnected,
    address,
    truncatedAddress,
    formattedBalance,
    connect,
  } = useActiveWalletAccount();

  function handleCopy() {
    if (!address) return;
    void navigator.clipboard?.writeText?.(address);
  }

  return (
    <div
      className={[
        "flex w-full flex-col items-start justify-center gap-4",
        "rounded-[var(--radius-pipeline-card)]",
        "bg-[color:var(--color-pipeline-surface)]",
        "px-2 pt-4 pb-2",
      ].join(" ")}
      data-testid="account-wallet-card"
      data-node-id={isConnected ? "6701:98142" : "6701:98104"}
    >
      <div className="flex w-full flex-col items-start px-2">
        <SegmentedTabs
          tabs={NAMESPACE_TABS}
          activeId={kind}
          onSelect={(id) => setKind(id as "evm" | "stellar")}
          variant="track"
          data-node-id="6701:98144"
        />
      </div>

      {isConnected ? (
        <div
          className="flex w-full flex-col items-start gap-2"
          data-node-id="6701:98145"
        >
          <AccountListRow
            variant="plain"
            leading={
              <AccountIconTile>
                <WalletGlyph size={20} />
              </AccountIconTile>
            }
            caption="Wallet"
            title={truncatedAddress ?? "—"}
            trailing={
              <div className="flex size-10 shrink-0 items-center justify-center p-1">
                <button
                  type="button"
                  aria-label="Copy wallet address"
                  onClick={handleCopy}
                  className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-pill)] text-[color:var(--color-pipeline-ink)]"
                >
                  <CopyIcon />
                </button>
              </div>
            }
            data-node-id="6701:98146"
          />
          <AccountListRow
            variant="plain"
            leading={<CoinIcon token="usdc" size="lg" aria-hidden />}
            caption="USDC balance"
            title={formattedBalance ?? "—"}
            data-node-id="6701:98147"
          />
        </div>
      ) : (
        <div
          className="flex w-full flex-col items-center gap-10 px-2 pt-4 pb-2"
          data-node-id="6701:98107"
        >
          <div className="flex size-18 items-center justify-center rounded-[var(--radius-pipeline-pill)] bg-[color:var(--color-pipeline-fill-muted)] text-[color:var(--color-pipeline-ink-subtle)]">
            <WalletGlyph size={36} />
          </div>
          <Button variant="primary-dark" className="w-full" onClick={connect}>
            Connect Wallet
          </Button>
        </div>
      )}
    </div>
  );
}

export default AccountWalletCard;
