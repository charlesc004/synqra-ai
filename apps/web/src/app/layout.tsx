import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "@/providers/workspace";
import "@/styles/globals.css";
import "@/styles/auth-cosmic.css";
export const metadata: Metadata = {
  title: "SYNQRA AI — Connected knowledge",
  description: "An evidence-grounded AI workspace for your team's knowledge.",
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading request headers opts every page into rendering with a fresh CSP nonce.
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html lang="en">
      <body>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
