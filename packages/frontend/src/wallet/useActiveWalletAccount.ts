// spec: docs/frontend/account-page.md#useactivewalletaccount
import { useEvmWallet } from "./evm/useEvmWallet";
import { useEvmToken } from "./evm/useEvmToken";
import { useDepositManagerAddresses } from "./evm/useDepositManager";
import { useStellarWallet } from "./stellar/useStellarWallet";
import { useStellarToken } from "./stellar/useStellarToken";
import { useWalletView, type WalletViewKind } from "./WalletViewContext";
import { useConnectModal } from "./ConnectModalContext";
import { truncateAddress } from "@/utils/truncateAddress";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface UseActiveWalletAccountResult {
  kind: WalletViewKind;
  setKind: (k: WalletViewKind) => void;
  isConnected: boolean;
  address: string | undefined;
  truncatedAddress: string | undefined;
  formattedBalance: string | undefined;
  connect: () => void;
}

export function useActiveWalletAccount(): UseActiveWalletAccountResult {
  const { kind, setKind } = useWalletView();

  const evm = useEvmWallet();
  const { usdc: usdcAddress } = useDepositManagerAddresses();
  const evmToken = useEvmToken({
    token: usdcAddress ?? (ZERO_ADDRESS as `0x${string}`),
  });

  const stellar = useStellarWallet();
  const stellarToken = useStellarToken();

  const { open } = useConnectModal();

  const isConnected = kind === "evm" ? evm.isConnected : stellar.isConnected;
  const address =
    kind === "evm"
      ? evm.isConnected
        ? evm.address
        : undefined
      : stellar.isConnected
        ? stellar.address
        : undefined;

  const formattedBalance =
    kind === "evm" ? evmToken.formattedBalance : stellarToken.formattedBalance;

  return {
    kind,
    setKind,
    isConnected,
    address,
    truncatedAddress: address ? truncateAddress(address) : undefined,
    formattedBalance,
    connect: open,
  };
}
