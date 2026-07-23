import type { Metadata } from "next";
import AdminOperations from "./AdminOperations";

export const metadata: Metadata = {
  title: "Operations Admin | PartPulse",
  description: "Tenant publishing oversight, audit history, worker health, and failed-job recovery",
};

export default function AdminPage() {
  return <AdminOperations />;
}
