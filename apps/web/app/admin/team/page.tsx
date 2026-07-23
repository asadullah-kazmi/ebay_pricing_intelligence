import type { Metadata } from "next";
import TeamManagement from "./TeamManagement";

export const metadata: Metadata = {
  title: "Team Management | PartPulse",
  description: "Manage organization members, roles, and secure invitations",
};

export default function TeamPage() {
  return <TeamManagement />;
}
