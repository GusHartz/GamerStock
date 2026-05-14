import { useEffect, useState } from "react";
import { SiSteam } from "react-icons/si";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

const STEAM_ERROR_LABELS: Record<string, string> = {
  SESSION_EXPIRED:     "Your session expired. Please log in again and retry.",
  SIGNATURE_MISMATCH:  "Steam signature verification failed. Please try again.",
  IDENTITY_MISMATCH:   "The Steam account returned doesn't match the one on file.",
  AUTO_CREATE_FAILED:  "Could not create your Steam account automatically. Please try again.",
  NO_STEAM_ACCOUNT:    "No Steam account found. Please try connecting again.",
  SERVER_ERROR:        "A server error occurred. Please try again.",
};

export default function SteamCallbackPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorLabel, setErrorLabel] = useState<string>("");

  useEffect(() => {
    const params   = new URLSearchParams(window.location.search);
    const verified = params.get("steam_verified");
    const error    = params.get("steam_error");

    if (verified === "1") {
      setStatus("success");
      const payload = { type: "STEAM_AUTH_RESULT", success: true };
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch {
        // blocked by browser policy — no-op
      }
      const t = setTimeout(() => { try { window.close(); } catch { } }, 1500);
      return () => clearTimeout(t);
    }

    if (error) {
      setStatus("error");
      setErrorLabel(STEAM_ERROR_LABELS[error] ?? `Verification error: ${error}`);
      const payload = { type: "STEAM_AUTH_RESULT", success: false, error };
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch {
        // blocked
      }
      const t = setTimeout(() => { try { window.close(); } catch { } }, 3000);
      return () => clearTimeout(t);
    }

    // No params — unexpected state
    setStatus("error");
    setErrorLabel("Unexpected state. Please close this window and try again.");
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "STEAM_AUTH_RESULT", success: false, error: "UNKNOWN" },
          window.location.origin,
        );
      }
    } catch { }
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 max-w-sm px-6 text-center">
        <SiSteam className="w-10 h-10 text-white/30" />

        {status === "loading" && (
          <>
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
            <p className="text-white/50 text-sm">Finishing Steam verification…</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            <p className="text-white font-medium">Steam Verified</p>
            <p className="text-white/40 text-sm">You can close this window.</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-9 h-9 text-red-400" />
            <p className="text-white font-medium">Verification Failed</p>
            <p className="text-white/50 text-sm leading-relaxed">{errorLabel}</p>
            <p className="text-white/25 text-xs">This window will close automatically.</p>
          </>
        )}
      </div>
    </div>
  );
}
