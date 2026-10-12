// spec: docs/frontend/account-page.md#route
import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ENV } from "@/lib/env";
import { useAuthSession } from "@/auth";
import { useWalletPresence } from "@/wallet";
import { AccountPage } from "@/components/account/AccountPage";
import {
  parseAccountStatePreview,
  type AccountDocumentsState,
} from "@/components/account/accountPageState";

export const Route = createFileRoute("/account")({
  validateSearch: (raw): { state: AccountDocumentsState | undefined } => ({
    state: ENV.IS_DEV ? parseAccountStatePreview(raw.state) : undefined,
  }),
  component: AccountRoute,
});

function AccountRoute() {
  const { state } = Route.useSearch();
  const navigate = useNavigate();
  const { isAuthenticated, signOut } = useAuthSession();
  const { isAnyConnected, isSettled, disconnectAll } = useWalletPresence();

  const blocked = !ENV.IS_DEV && !isAuthenticated && !isAnyConnected;

  useEffect(() => {
    if (blocked && isSettled) void navigate({ to: "/", replace: true });
  }, [blocked, isSettled, navigate]);

  if (blocked) return null;

  return (
    <AccountPage
      previewState={state}
      onLogOut={() => {
        if (isAuthenticated) signOut();
        else disconnectAll();
        void navigate({ to: "/" });
      }}
    />
  );
}
