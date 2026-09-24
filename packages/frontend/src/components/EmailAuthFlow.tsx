// spec: docs/frontend/auth-components.md#emailauthflow
import { SignInModal } from "@/components/SignInModal";
import { CreateAccountModal } from "@/components/CreateAccountModal";
import { OtpModal } from "@/components/OtpModal";
import { ForgotPasswordModal } from "@/components/ForgotPasswordModal";
import { Turnstile } from "@/components/Turnstile";
import {
  useEmailAuthFlow,
  type EmailAuthScreen,
} from "@/components/useEmailAuthFlow";

export interface EmailAuthFlowProps {
  open: boolean;
  initialScreen?: EmailAuthScreen;
  onClose: () => void;
  onAuthenticated?: () => void;
  onConnectWallet?: () => void;
  onForgotPasswordSubmit?: (payload: { email: string }) => void;
}

export function EmailAuthFlow({
  open,
  initialScreen,
  onClose,
  onAuthenticated,
  onConnectWallet,
  onForgotPasswordSubmit,
}: EmailAuthFlowProps) {
  const flow = useEmailAuthFlow({
    open,
    initialScreen,
    onClose,
    onAuthenticated,
    onConnectWallet,
  });

  return (
    <>
      <SignInModal
        open={open && flow.screen === "sign-in"}
        onDismiss={flow.dismiss}
        onSubmit={flow.handleSignInSubmit}
        onContinueWithWallet={flow.handleContinueWithWallet}
        onForgotPassword={flow.goToForgotPassword}
        onCreateAccount={flow.goToCreateAccount}
        passwordServerError={flow.passwordServerError}
        formError={flow.signInFormError}
      />
      <CreateAccountModal
        open={open && flow.screen === "create-account"}
        onDismiss={flow.dismiss}
        onSubmit={flow.handleCreateAccountSubmit}
        onContinueWithWallet={flow.handleContinueWithWallet}
        onSignIn={flow.goToSignIn}
        formError={flow.createAccountFormError}
        captchaReady={flow.signupCaptchaReady}
        turnstileSlot={
          open && flow.screen === "create-account" ? (
            <Turnstile
              ref={flow.signupTurnstileRef}
              onToken={flow.onSignupToken}
            />
          ) : null
        }
      />
      <OtpModal
        open={open && flow.screen === "otp"}
        onBack={flow.goToSignIn}
        email={flow.pendingEmail}
        verify={flow.handleOtpVerify}
        resend={flow.handleOtpResend}
        turnstileSlot={
          open && flow.screen === "otp" ? (
            <Turnstile ref={flow.otpTurnstileRef} onToken={flow.onOtpToken} />
          ) : null
        }
      />
      <ForgotPasswordModal
        open={open && flow.screen === "forgot-password"}
        onDismiss={flow.dismiss}
        onBackToSignIn={flow.goToSignIn}
        onSubmit={(payload) => {
          onForgotPasswordSubmit?.(payload);
          flow.dismiss();
        }}
      />
    </>
  );
}

export default EmailAuthFlow;
