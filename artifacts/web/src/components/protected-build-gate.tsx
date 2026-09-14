import { useEffect, useState } from "react";
import {
  formatLicenseError,
  getInstallDeviceId,
  verifyLicense,
  type LicenseResult,
} from "../../../../lib/license-core/src/index";

const DEVICE_STORAGE_KEY = "damasc…e-id";
const LICENSE_PLATFORM = ((import.meta.env.VITE_LICENSE_PLATFORM ?? "android") as "android" | "windows");
const LICENSE_PUBLIC_KEY = (import.meta.env.VITE_LICENSE_PUBLIC_KEY ?? "") || undefined;
const LICENSE_STORAGE_KEY = "damasc…ense";

// Server-license flow: the PROTECTED desktop build binds the license to the
// MACHINE (the API server persists deviceId + license), so every browser
// window on the same machine is activated together. The offline (Android)
// build keeps the per-device browser-localStorage flow.
const SERVER_FLOW =
  import.meta.env.VITE_PROTECTED_BUILD === "1" && import.meta.env.VITE_OFFLINE_MODE !== "1";

type ServerStatus = { deviceId: string; activated: boolean; status: string };

function statusMessage(result: LicenseResult): string {
  if (result.status === "unsupported") {
    return "لا يدعم هذا الجهاز التحقق الآمن من الترخيص. استخدم إصداراً أحدث من النظام.";
  }
  return formatLicenseError(result.status);
}

export function ProtectedBuildGate({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState("");
  const [license, setLicense] = useState("");
  const [result, setResult] = useState<LicenseResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    if (SERVER_FLOW) {
      fetch("/api/license/status")
        .then((r) => r.json())
        .then((s: ServerStatus) => {
          setServerStatus(s);
          setDeviceId(s.deviceId ?? "");
        })
        .catch(() => setServerStatus({ deviceId: "(server unreachable)", activated: false, status: "missing" }))
        .finally(() => setChecking(false));
      return;
    }
    const id = getInstallDeviceId(window.localStorage, DEVICE_STORAGE_KEY);
    const saved = window.localStorage.getItem(LICENSE_STORAGE_KEY) ?? "";
    setDeviceId(id);
    setLicense(saved);
    verifyLicense(saved, { platform: LICENSE_PLATFORM, deviceId: id, appVersion: import.meta.env.VITE_APP_VERSION ?? "*", publicKeySpkiBase64: LICENSE_PUBLIC_KEY })
      .then(setResult)
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200" dir="rtl">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-400 border-t-transparent" aria-label="جار التحقق" />
      </main>
    );
  }

  const activated = SERVER_FLOW ? (serverStatus?.activated ?? false) : result?.status === "valid";
  if (activated) return children;

  async function activate() {
    setActivating(true);
    if (SERVER_FLOW) {
      try {
        const res = await fetch("/api/license/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ license: license.trim() }),
        });
        const data = (await res.json()) as { status?: string; ok?: boolean };
        if (data.ok) {
          const s = await fetch("/api/license/status").then((r) => r.json());
          setServerStatus(s);
          setResult({ status: "valid" });
        } else {
          setResult({ status: (data.status ?? "invalid") as LicenseResult["status"] });
        }
      } catch {
        setResult({ status: "unsupported" });
      }
      setActivating(false);
      return;
    }
    const next = license.trim();
    const checked = await verifyLicense(next, {
      platform: LICENSE_PLATFORM,
      deviceId, publicKeySpkiBase64: LICENSE_PUBLIC_KEY,
      appVersion: import.meta.env.VITE_APP_VERSION ?? "*",
    });
    if (checked.status === "valid") {
      window.localStorage.setItem(LICENSE_STORAGE_KEY, next);
    }
    setResult(checked);
    setActivating(false);
  }

  async function copyDeviceId() {
    await navigator.clipboard?.writeText(deviceId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100" dir="rtl">
      <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mb-3 text-4xl" aria-hidden="true">🔐</div>
          <h1 className="text-2xl font-bold text-sky-300">نسخة محمية</h1>
          <p className="mt-2 text-sm text-slate-400">مستودعات مديرية صحة دمشق</p>
        </div>

        <div className="rounded-xl border border-sky-700/70 bg-slate-950 p-4 text-center">
          <p className="mb-2 text-xs text-slate-400">معرّف هذا الجهاز</p>
          <code className="break-all text-sm font-bold tracking-widest text-sky-300">{deviceId}</code>
          <button
            type="button"
            onClick={copyDeviceId}
            className="mt-3 rounded-lg border border-sky-500 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/10"
          >
            {copied ? "تم النسخ" : "نسخ المعرّف"}
          </button>
        </div>

        <ol className="my-5 space-y-2 rounded-lg border-r-4 border-amber-500 bg-slate-800/70 p-4 text-sm text-slate-300">
          <li>1. انسخ معرّف الجهاز أعلاه.</li>
          <li>2. أرسله إلى مسؤول النظام لإصدار الترخيص.</li>
          <li>3. ألصق الترخيص الموقع في الحقل أدناه.</li>
        </ol>

        <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="protected-license">
          ملف أو نص الترخيص الموقع
        </label>
        <textarea
          id="protected-license"
          value={license}
          onChange={(event) => setLicense(event.target.value)}
          rows={5}
          dir="ltr"
          spellCheck={false}
          placeholder="eyJ... .signature..."
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <p className="mt-3 text-center text-[10px] text-slate-600" dir="ltr">Gate 4.0.3.0 - noble-ed25519 fallback</p>
        {result && (
          <>
            <p className="mt-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{statusMessage(result)}</p>
            <p className="mt-2 text-center text-[10px] text-slate-500" dir="ltr">
              status={result.status} | gate-device={deviceId} | license-device={(result.license?.deviceId as string) ?? "-"} | keyId={(result.license?.keyId as string) ?? "-"}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={activate}
          disabled={activating}
          className="mt-4 w-full rounded-lg bg-sky-500 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
        >
          {activating ? "جارٍ التحقق..." : "تفعيل التطبيق"}
        </button>
      </section>
    </main>
  );
}
