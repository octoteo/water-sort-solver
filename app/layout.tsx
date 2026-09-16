import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./v03.css";
import "./v04.css";
import PwaRegister from "./pwa-register";

export const metadata: Metadata = {
  title: "Water Sort Solver",
  description: "Offline-first Water Sort puzzle solver with local screenshot recognition, worker search, Android share target and visual execution guidance.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "Water Sort",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><PwaRegister />{children}</body></html>;
}
