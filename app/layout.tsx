import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Water Sort Solver",
  description: "Offline-first Water Sort puzzle solver with manual editing and ad-cup aware search.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
