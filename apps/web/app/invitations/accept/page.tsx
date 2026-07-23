import type { Metadata } from "next";
import InvitationAcceptance from "./InvitationAcceptance";

export const metadata: Metadata = {
  title: "Accept Invitation | PartPulse",
  description: "Join a PartPulse organization using a secure invitation",
};

export default function AcceptInvitationPage() {
  return <InvitationAcceptance />;
}
