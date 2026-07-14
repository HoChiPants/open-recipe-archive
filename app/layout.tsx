import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "A portable, searchable library of recipes stored as open JSON data.";

  return {
    title: "Open Recipe Archive",
    description,
    openGraph: {
      title: "Open Recipe Archive",
      description,
      images: [{ url: `${origin}/og.png`, width: 1731, height: 907, alt: "Open Recipe Archive — Recipes in plain JSON." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Open Recipe Archive",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
