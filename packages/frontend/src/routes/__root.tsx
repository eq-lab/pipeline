import { createRootRoute, Outlet } from "@tanstack/react-router";
import { RiskBanner } from "@pipeline/ui";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";
import { useSuspensionSignOut } from "@/auth";

// spec: docs/frontend/dashboard-components.md#root-layout
export function RootLayout() {
  useSuspensionSignOut();
  return (
    <>
      <RiskBanner />
      <TopBar />
      <Outlet />
      <Footer />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
