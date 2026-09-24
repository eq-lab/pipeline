// spec: docs/frontend/account-page.md#route
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ENV } from "@/lib/env";
import { readSession } from "@/auth/session";
import { useAuthSession } from "@/auth";
import { AccountPage } from "@/components/account/AccountPage";
import {
  parseAccountStatePreview,
  type AccountDocumentsState,
} from "@/components/account/accountPageState";

export const Route = createFileRoute("/account")({
  beforeLoad: () => {
    if (!ENV.IS_DEV && readSession() === null) throw redirect({ to: "/" });
  },
  validateSearch: (raw): { state: AccountDocumentsState | undefined } => ({
    state: ENV.IS_DEV ? parseAccountStatePreview(raw.state) : undefined,
  }),
  component: AccountRoute,
});

function AccountRoute() {
  const { state } = Route.useSearch();
  const navigate = useNavigate();
  const { signOut } = useAuthSession();
  return (
    <AccountPage
      previewState={state}
      onLogOut={() => {
        signOut();
        void navigate({ to: "/" });
      }}
    />
  );
}
