import type { Metadata } from "next";
import NotificationCenter from "./NotificationCenter";

export const metadata: Metadata = {
  title: "Notifications | PartPulse",
  description: "Operational alerts and email preferences for PartPulse",
};

export default function NotificationsPage() {
  return <NotificationCenter />;
}
