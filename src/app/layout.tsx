import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muse Board",
  description:
    "A collaborative moodboard studio with infinite-canvas inspiration boards, quick image drops, text composition, and workspace switching.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
