import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DayBook · Your money, in your words",
  description:
    "Voice-first personal ledger with two specialized agents, explicit review, and balanced financial records.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
