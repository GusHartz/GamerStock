import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Info } from "lucide-react";

interface VersionInfo {
  buildId: string;
  buildTime: string | null;
  environment: string;
}

export function BuildBadge() {
  const [showModal, setShowModal] = useState(false);

  const { data } = useQuery<VersionInfo>({
    queryKey: ["/api/version"],
    staleTime: Infinity,
  });

  if (!data) return null;

  const shortId = data.buildId.slice(0, 12);
  const timeLabel = data.buildTime
    ? new Date(data.buildTime).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        data-testid="build-badge"
        title="View build info"
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/5 transition-colors leading-none"
      >
        <Info className="w-3 h-3 shrink-0" />
        <span>Build {shortId}</span>
        {timeLabel && <span className="hidden sm:inline opacity-70">• {timeLabel}</span>}
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center pb-10 px-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-sm bg-[#0D1117] border border-white/10 rounded-xl shadow-2xl p-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-muted-foreground hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              Build Info
            </h3>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted-foreground">Build ID</span>
                <span className="text-white">{data.buildId}</span>
              </div>
              {data.buildTime && (
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-muted-foreground">Built at</span>
                  <span className="text-white">{new Date(data.buildTime).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">Environment</span>
                <span className="text-white">{data.environment}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
