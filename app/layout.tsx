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
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
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
