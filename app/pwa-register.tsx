"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> };
type NativeSharePayload = { uri?: string; mimeType?: string; name?: string };
type NativeShareReceiverPlugin = { getPendingShare: () => Promise<NativeSharePayload>; clearPendingShare: () => Promise<void>; addListener: (eventName: "shareReceived", listener: (payload: NativeSharePayload) => void) => Promise<{ remove: () => Promise<void> }> };
type NativeCapturePayload = { uri?: string; mimeType?: string; name?: string; width?: number; height?: number };
type CaptureSessionState = { active: boolean; inMultiWindow?: boolean; reason?: string };
type NativeScreenCapturePlugin = {
  getCaptureSessionStatus: () => Promise<CaptureSessionState>;
  startCaptureSession: () => Promise<CaptureSessionState>;
  captureOtherPane: () => Promise<NativeCapturePayload>;
  stopCaptureSession: () => Promise<{ active: boolean }>;
  addListener: (eventName: "captureSessionChanged", listener: (payload: CaptureSessionState) => void) => Promise<{ remove: () => Promise<void> }>;
};
type NativeUpdateInfo = { available: boolean; currentVersionCode: number; currentVersionName: string; versionCode: number; versionName: string; apkUrl: string; notes?: string; manifestUrl?: string };
type NativeUpdaterPlugin = { getCurrentVersion: () => Promise<{ versionName: string; versionCode: number }>; checkForUpdate: () => Promise<NativeUpdateInfo>; installUpdate: (options: { apkUrl: string }) => Promise<{ started: boolean; needsPermission: boolean }> };

const NativeShareReceiver = registerPlugin<NativeShareReceiverPlugin>("ShareReceiver");
const NativeScreenCapture = registerPlugin<NativeScreenCapturePlugin>("ScreenCapture");
const NativeUpdater = registerPlugin<NativeUpdaterPlugin>("NativeUpdater");
const UPDATE_CHECK_KEY = "water-sort-native-update-check-v2";
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function isNativeApp() { return Capacitor.isNativePlatform(); }
function isNativeSharePage() { return typeof window !== "undefined" && (window.location.pathname === "/share" || window.location.pathname === "/share.html"); }
function isStandalone() { if (typeof window === "undefined") return false; if (isNativeApp()) return true; return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone); }
function wait(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
async function findScreenshotInput() { for (let attempt = 0; attempt < 30; attempt++) { const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]'); if (input && !input.disabled) return input; await wait(100); } return null; }
function fileExtension(mimeType: string) { if (mimeType.includes("png")) return "png"; if (mimeType.includes("webp")) return "webp"; if (mimeType.includes("gif")) return "gif"; if (mimeType.includes("heic") || mimeType.includes("heif")) return "heic"; return "jpg"; }
async function dispatchImageFile(file: File) { const input = await findScreenshotInput(); if (!input) throw new Error("没有找到截图输入区，请刷新页面后重试。"); const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); }

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [nativeRuntime, setNativeRuntime] = useState(false);
  const [nativeVersion, setNativeVersion] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureSessionActive, setCaptureSessionActive] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<NativeUpdateInfo | null>(null);
  const autoCaptureDone = useRef(false);

  useEffect(() => {
    const native = isNativeApp(); setNativeRuntime(native); setInstalled(isStandalone()); setOnline(navigator.onLine);
    if (!native && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => registration.update()).catch(() => setNotice("PWA 离线组件注册失败；普通上传和求解仍可使用。"));
    const onBeforeInstall = (event: Event) => { if (native) return; event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); setNotice("已安装到设备。之后可从系统分享菜单直接发送游戏截图。"); };
    const onOnline = () => setOnline(true); const onOffline = () => setOnline(false);
    window.addEventListener("beforeinstallprompt", onBeforeInstall); window.addEventListener("appinstalled", onInstalled); window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    if (!nativeRuntime) return; let cancelled = false;
    void (async () => { try { const current = await NativeUpdater.getCurrentVersion(); if (!cancelled) setNativeVersion(current.versionName); const lastCheck = Number(localStorage.getItem(UPDATE_CHECK_KEY) ?? 0) || 0; if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL) return; const update = await NativeUpdater.checkForUpdate(); localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now())); if (!cancelled && update.available) setUpdateInfo(update); } catch { /* convenience only */ } })();
    return () => { cancelled = true; };
  }, [nativeRuntime]);

  useEffect(() => {
    if (!nativeRuntime) return; let cancelled = false; let handle: { remove: () => Promise<void> } | null = null;
    void (async () => { try { const state = await NativeScreenCapture.getCaptureSessionStatus(); if (!cancelled) setCaptureSessionActive(state.active); handle = await NativeScreenCapture.addListener("captureSessionChanged", (payload) => { if (cancelled) return; setCaptureSessionActive(payload.active); if (!payload.active && payload.reason) setNotice(payload.reason); }); } catch { /* native bridge unavailable */ } })();
    return () => { cancelled = true; if (handle) void handle.remove(); };
  }, [nativeRuntime]);

  useEffect(() => {
    if (!nativeRuntime) return; let cancelled = false; let listenerHandle: { remove: () => Promise<void> } | null = null;
    const deliverNativeShare = async (supplied?: NativeSharePayload) => { try { const payload = supplied?.uri ? supplied : await NativeShareReceiver.getPendingShare(); if (!payload.uri || cancelled) return; if (!isNativeSharePage()) { window.location.href = "/share.html?native=1"; return; } const response = await fetch(Capacitor.convertFileSrc(payload.uri), { cache: "no-store" }); if (!response.ok) throw new Error("无法读取 Android 分享的截图，请重新分享一次。"); const blob = await response.blob(); if (cancelled) return; const mimeType = payload.mimeType || blob.type || "image/jpeg"; await dispatchImageFile(new File([blob], payload.name || `taote-screenshot.${fileExtension(mimeType)}`, { type: mimeType })); await NativeShareReceiver.clearPendingShare(); const params = new URLSearchParams(window.location.search); params.delete("native"); window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`); setNotice("已从 Android 系统分享接收截图；图片只在本机处理。"); } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : "读取 Android 分享截图失败。"); } };
    void (async () => { listenerHandle = await NativeShareReceiver.addListener("shareReceived", (payload) => void deliverNativeShare(payload)); await deliverNativeShare(); })();
    return () => { cancelled = true; if (listenerHandle) void listenerHandle.remove(); };
  }, [nativeRuntime]);

  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === "accepted") setInstallPrompt(null); };

  const captureSplitScreen = async () => {
    if (!nativeRuntime || captureBusy) return; setCaptureBusy(true);
    try {
      let active = captureSessionActive;
      if (!active) { const started = await NativeScreenCapture.startCaptureSession(); active = started.active; setCaptureSessionActive(active); }
      if (!active) throw new Error("连续分屏截图会话未能开启。");
      const payload = await NativeScreenCapture.captureOtherPane();
      if (!payload.uri) throw new Error("Android 没有返回分屏截图。");
      const response = await fetch(Capacitor.convertFileSrc(payload.uri), { cache: "no-store" }); if (!response.ok) throw new Error("无法读取刚刚截取的分屏画面。");
      const blob = await response.blob(); const mimeType = payload.mimeType || blob.type || "image/jpeg"; await dispatchImageFile(new File([blob], payload.name || `split-screen.${fileExtension(mimeType)}`, { type: mimeType }));
      setNotice(`已连续截取另一侧游戏窗口${payload.width && payload.height ? `（${payload.width}×${payload.height}）` : ""}，正在本地识别并自动求解。`);
    } catch (error) { try { const state = await NativeScreenCapture.getCaptureSessionStatus(); setCaptureSessionActive(state.active); } catch { /* ignore */ } setNotice(error instanceof Error ? error.message : "分屏截图失败。"); } finally { setCaptureBusy(false); }
  };

  const startContinuousSolve = async () => {
    if (!nativeRuntime || captureBusy) return; setCaptureBusy(true);
    try {
      const started = captureSessionActive ? await NativeScreenCapture.getCaptureSessionStatus() : await NativeScreenCapture.startCaptureSession();
      setCaptureSessionActive(started.active);
      if (!started.active) throw new Error("连续分屏截图会话未能开启。");
      if (!isNativeSharePage()) { window.location.href = `/share.html?continuous=1${started.inMultiWindow ? "&autocapture=1" : ""}`; return; }
      if (started.inMultiWindow) { setCaptureBusy(false); await captureSplitScreen(); return; }
      setNotice("连续截图已开启。请把 Water Sort Solver 与淘特切成分屏，然后点“连续截图”。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法开启连续分屏求解。"); } finally { setCaptureBusy(false); }
  };

  const stopContinuousSolve = async () => { if (!nativeRuntime) return; try { await NativeScreenCapture.stopCaptureSession(); } finally { setCaptureSessionActive(false); setNotice("已结束连续分屏截图会话。"); } };

  useEffect(() => {
    if (!nativeRuntime || !captureSessionActive || !isNativeSharePage() || autoCaptureDone.current) return;
    const params = new URLSearchParams(window.location.search); if (params.get("autocapture") !== "1") return;
    autoCaptureDone.current = true; params.delete("autocapture"); window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    void captureSplitScreen();
  }, [nativeRuntime, captureSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkNativeUpdate = async () => { if (!nativeRuntime || updateBusy) return; setUpdateBusy(true); try { const update = await NativeUpdater.checkForUpdate(); localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now())); setUpdateInfo(update.available ? update : null); setNotice(update.available ? `发现新版本 v${update.versionName}。` : `当前 v${update.currentVersionName} 已是最新版本。`); } catch (error) { setNotice(error instanceof Error ? error.message : "检查更新失败。"); } finally { setUpdateBusy(false); } };
  const installNativeUpdate = async () => { if (!updateInfo || updateBusy) return; setUpdateBusy(true); try { const result = await NativeUpdater.installUpdate({ apkUrl: updateInfo.apkUrl }); if (result.needsPermission) setNotice("请在系统设置中允许 Water Sort Solver“安装未知应用”，返回后再点一次更新。"); else if (result.started) setNotice("新版 APK 已下载，按 Android 系统安装提示完成更新即可；原有本机数据会保留。"); } catch (error) { setNotice(error instanceof Error ? error.message : "安装更新失败。"); } finally { setUpdateBusy(false); } };

  const nativeSharePage = nativeRuntime && isNativeSharePage();
  return <>
    {!installed && installPrompt && <button className="pwa-install-fab" type="button" onClick={() => void install()}>安装到桌面</button>}
    {!nativeRuntime && !online && <div className="pwa-offline-chip">离线模式</div>}
    {nativeRuntime && <div className={`native-tool-dock ${nativeSharePage ? "" : "native-update-only"}`} role="group" aria-label="Android 原生工具">
      {!nativeSharePage && <button className="native-session-start" type="button" disabled={captureBusy} onClick={() => void startContinuousSolve()}>{captureBusy ? "正在开启…" : captureSessionActive ? "▶ 进入连续求解" : "▶ 开始分屏求解"}</button>}
      {nativeSharePage && <button className="native-split-capture" type="button" disabled={captureBusy} onClick={() => void (captureSessionActive ? captureSplitScreen() : startContinuousSolve())}>{captureBusy ? "正在截图…" : captureSessionActive ? "📸 连续截图" : "▶ 开始分屏"}</button>}
      {nativeSharePage && captureSessionActive && <button className="native-session-stop" type="button" onClick={() => void stopContinuousSolve()}>结束</button>}
      <button className="native-update-button" type="button" disabled={updateBusy} onClick={() => void checkNativeUpdate()}>{updateBusy ? "检查中…" : `检查更新${nativeVersion ? ` · v${nativeVersion}` : ""}`}</button>
    </div>}
    {nativeRuntime && updateInfo?.available && <div className="native-update-banner"><div><strong>发现 v{updateInfo.versionName}</strong><span>{updateInfo.notes || "有新的 Android 版本可安装。"}</span></div><button type="button" disabled={updateBusy} onClick={() => void installNativeUpdate()}>{updateBusy ? "准备中…" : "立即更新"}</button><button className="native-update-close" type="button" aria-label="稍后更新" onClick={() => setUpdateInfo(null)}>×</button></div>}
    {notice && <button className="pwa-notice" type="button" onClick={() => setNotice(null)} title="点击关闭">{notice}</button>}
  </>;
}
