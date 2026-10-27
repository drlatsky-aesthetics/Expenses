import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { PRACTICE_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Expenses — ${PRACTICE_NAME}`,
  description: "Receipt and expense tracker for the practice.",
  applicationName: "Expenses",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Expenses",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f2129" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Jost:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="wrap">
          <div className="card">
            <Nav />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
