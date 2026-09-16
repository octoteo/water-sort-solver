"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function findScreenshotInput() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
    if (input && !input.disabled) return input;
    await wait(100);
  }
  return null;
}

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setInstalled(isStandalone());
    setOnline(navigator.onLine);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => registration.update()).catch(() => {
        setNotice("PWA 离线组件注册失败；普通上传和求解仍可使用。");
      });
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setNotice("已安装到设备。之后可从系统分享菜单直接发送游戏截图。");
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("shared");
    if (!token) return;

    let cancelled = false;
    void (async () => {
      try {
        if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
        const response = await fetch(`/__shared_image__/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("分享截图已失效，请重新分享一次。");
        const blob = await response.blob();
        const input = await findScreenshotInput();
        if (!input) throw new Error("没有找到截图输入区，请刷新页面后重试。");
        if (cancelled) return;

        const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        const file = new File([blob], `shared-water-sort.${extension}`, { type: blob.type || "image/jpeg" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));

        params.delete("shared");
        const nextSearch = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
        navigator.serviceWorker.controller?.postMessage({ type: "delete-shared", token });
        setNotice("已把系统分享的截图载入完整编辑器，可以核对识别结果后求解。");
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "读取系统分享截图失败。");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  return (
    <>
      {!installed && installPrompt && <button className="pwa-install-fab" type="button" onClick={() => void install()}>安装到桌面</button>}
      {!online && <div className="pwa-offline-chip">离线模式</div>}
      {notice && <button className="pwa-notice" type="button" onClick={() => setNotice(null)} title="点击关闭">{notice}</button>}
    </>
  );
}
