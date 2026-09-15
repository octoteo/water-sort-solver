import type { Metadata } from "next";
import "./globals.css";
import "./v03.css";

export const metadata: Metadata = {
  title: "Water Sort Solver",
  description: "Offline-first Water Sort puzzle solver with local screenshot recognition, worker search and visual execution guidance.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
