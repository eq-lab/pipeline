// spec: docs/frontend/auth-components.md#resetpasswordmodal
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuthFlow } from "@/auth";
import { ResetPasswordModal } from "@/components/ResetPasswordModal";
import { useResetPasswordFlow } from "@/components/useResetPasswordFlow";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
  const navigate = useNavigate();
  const { open: openAuthFlow } = useAuthFlow();
  const flow = useResetPasswordFlow();

  function leaveTo(screen?: "sign-in" | "forgot-password") {
    void navigate({ to: "/", replace: true });
    if (screen) openAuthFlow(screen);
  }

  return (
    <main className="min-h-[60vh]" data-testid="reset-password-route">
      <ResetPasswordModal
        open
        view={flow.view}
        onDismiss={() => leaveTo()}
        onSubmit={flow.submit}
        onPasswordEdit={flow.clearErrors}
        formError={flow.formError}
        passwordServerError={flow.passwordServerError}
        onSignIn={() => leaveTo("sign-in")}
        onRequestNewLink={() => leaveTo("forgot-password")}
      />
    </main>
  );
}
