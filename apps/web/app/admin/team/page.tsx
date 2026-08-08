import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Team Management | PartPulse",
  description: "Manage organization members, roles, and secure invitations",
};

export default function TeamPage() {
  redirect("/settings");
}
