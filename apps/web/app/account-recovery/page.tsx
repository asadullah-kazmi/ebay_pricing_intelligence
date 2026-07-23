import type { Metadata } from "next";
import AccountRecoveryRequest from "./AccountRecoveryRequest";

export const metadata: Metadata = {
  title: "Account Recovery | PartPulse",
  description: "Recover a PartPulse account when password or authenticator access is lost",
};

export default function AccountRecoveryPage() {
  return <AccountRecoveryRequest />;
}
