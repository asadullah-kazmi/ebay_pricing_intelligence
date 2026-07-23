import type { Metadata } from "next";
import AccountRecoveryConfirm from "./AccountRecoveryConfirm";

export const metadata: Metadata = {
  title: "Confirm Account Recovery | PartPulse",
  description: "Securely replace account credentials and remove a lost authenticator",
};

export default function AccountRecoveryConfirmPage() {
  return <AccountRecoveryConfirm />;
}
