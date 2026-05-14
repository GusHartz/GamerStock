import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PredictAdminLayout, AdminSectionCard } from "./predict-layout";
import {
  Upload, ImageIcon, Trash2, Copy, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, LayoutGrid, List, FileImage, Info,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaAsset = {
  id:              number;
  storageKey:      string;
  publicUrl:       string;
  mimeType:        string;
  fileName:        string;
  fileSize:        number;
  width:           number | null;
  height:          number | null;
  assetType:       string;
  createdBy:       string | null;
  createdAt:       string;
};

type LibraryResponse = {
  data:   MediaAsset[];
  total:  number;
  limit:  number;
  offset: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024)       return `${n} B`;
  if (n < 1048576)    return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

async function adminPost(path: string, formData: FormData) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? json.message ?? "Upload failed");
  return json;
}

// ─── Delete confirmation dialog ────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  asset: MediaAsset | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function DeleteConfirmDialog({ asset, onConfirm, onCancel, isPending }: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={!!asset}>
      <AlertDialogContent className="bg-neutral-900 border border-neutral-700 text-neutral-200">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">Delete this image permanently?</AlertDialogTitle>
          <AlertDialogDescription className="text-neutral-400 leading-relaxed">
            This will also remove it from any linked cards or event media attachments.
            {asset && (
              <span className="block mt-2 font-mono text-xs text-neutral-500 truncate">
                {asset.fileName}
              </span>
            )}
            <span className="block mt-2 font-semibold text-rose-400">
              This action cannot be undone.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onCancel}
            className="border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-rose-600 hover:bg-rose-500 text-white border-0"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
            {isPending ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onSuccess }: { onSuccess: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview]   = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileObj, setFileObj]   = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return adminPost("/api/admin/media/upload", fd);
    },
    onSuccess: (data) => {
      toast({ title: "Uploaded", description: `"${data.asset.fileName}" saved to library` });
      setPreview(null);
      setFileName(null);
      setFileObj(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media"] });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Only image files are accepted", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    setFileObj(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, [toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="space-y-4">
      {!preview ? (
        <div
          data-testid="media-dropzone"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
            p-10 cursor-pointer transition-all
            ${dragging
              ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
              : "border-white/10 hover:border-white/25 text-muted-foreground hover:text-white/70"}
          `}
        >
          <Upload className="w-8 h-8 opacity-70" />
          <p className="text-sm font-medium">Drop an image here or <span className="text-cyan-400">browse</span></p>
          <p className="text-xs opacity-50">jpg · png · webp · svg · gif · max 10 MB</p>
          <input
            ref={inputRef}
            data-testid="input-media-file"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={onInputChange}
          />
        </div>
      ) : (
        <div className="flex gap-4 items-start p-4 rounded-xl border border-white/10 bg-black/20">
          <img
            src={preview}
            alt={fileName ?? "preview"}
            className="w-24 h-24 object-cover rounded-lg border border-white/10"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{fileName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{fmtBytes(fileObj?.size ?? 0)}</p>
            <div className="mt-3 flex gap-2">
              <button
                data-testid="button-confirm-upload"
                onClick={() => fileObj && uploadMutation.mutate(fileObj)}
                disabled={uploadMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-cyan-500 hover:bg-cyan-400 text-black font-semibold disabled:opacity-50 transition-colors"
              >
                {uploadMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <CheckCircle2 className="w-3.5 h-3.5" />}
                {uploadMutation.isPending ? "Uploading…" : "Confirm upload"}
              </button>
              <button
                data-testid="button-cancel-upload"
                onClick={() => { setPreview(null); setFileName(null); setFileObj(null); }}
                className="px-3 py-1.5 text-xs rounded-md border border-white/10 hover:border-white/25 text-muted-foreground hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asset card ───────────────────────────────────────────────────────────────

interface AssetCardProps {
  asset: MediaAsset;
  onDeleteRequest: (asset: MediaAsset) => void;
}

function AssetCard({ asset, onDeleteRequest }: AssetCardProps) {
  const [copied, setCopied] = useState(false);

  const copyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(asset.publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div
      data-testid={`card-media-asset-${asset.id}`}
      className="group relative rounded-xl border border-white/[0.07] bg-white/[0.03] hover:border-cyan-400/30 hover:bg-white/[0.06] transition-all overflow-hidden"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-black/30 overflow-hidden relative">
        <img
          src={asset.publicUrl}
          alt={asset.fileName}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
      </div>

      {/* Meta */}
      <div className="p-3 space-y-2">
        <p className="text-xs font-medium text-white truncate" title={asset.fileName}>{asset.fileName}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground/70 bg-white/[0.06] rounded px-1.5 py-0.5">
            {asset.mimeType.split("/")[1]}
          </span>
          <span className="text-[10px] text-muted-foreground/50">{fmtBytes(asset.fileSize)}</span>
          {asset.width && (
            <span className="text-[10px] text-muted-foreground/50">{asset.width}×{asset.height}</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40">{fmtDate(asset.createdAt)}</p>
      </div>

      {/* Hover overlay — copy + delete actions */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <button
          data-testid={`button-copy-url-${asset.id}`}
          onClick={copyUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-cyan-500 hover:bg-cyan-400 text-black font-semibold transition-colors"
        >
          {copied
            ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copied!</>
            : <><Copy className="w-3.5 h-3.5" /> Copy URL</>}
        </button>
        <button
          data-testid={`button-delete-asset-${asset.id}`}
          onClick={(e) => { e.stopPropagation(); onDeleteRequest(asset); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors"
          title="Delete image"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Asset row (list view) ────────────────────────────────────────────────────

interface AssetRowProps {
  asset: MediaAsset;
  onDeleteRequest: (asset: MediaAsset) => void;
}

function AssetRow({ asset, onDeleteRequest }: AssetRowProps) {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(asset.publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div
      data-testid={`row-media-asset-${asset.id}`}
      className="flex items-center gap-4 px-4 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04] transition-all"
    >
      <img
        src={asset.publicUrl}
        alt={asset.fileName}
        className="w-10 h-10 rounded object-cover border border-white/10 shrink-0"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white truncate">{asset.fileName}</p>
        <p className="text-[10px] font-mono text-muted-foreground/50 truncate">{asset.publicUrl}</p>
      </div>
      <span className="text-[10px] text-muted-foreground/50 shrink-0">{fmtBytes(asset.fileSize)}</span>
      <span className="text-[10px] text-muted-foreground/50 shrink-0 hidden sm:block">{fmtDate(asset.createdAt)}</span>
      <button
        data-testid={`button-row-copy-url-${asset.id}`}
        onClick={copyUrl}
        className="shrink-0 p-1.5 rounded border border-white/10 hover:border-cyan-400/40 text-muted-foreground hover:text-cyan-400 transition-colors"
        title="Copy URL"
      >
        {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button
        data-testid={`button-row-delete-asset-${asset.id}`}
        onClick={() => onDeleteRequest(asset)}
        className="shrink-0 p-1.5 rounded border border-rose-800/40 text-rose-600 hover:bg-rose-900/30 hover:text-rose-400 hover:border-rose-600/60 transition-colors"
        title="Delete image"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Asset specs ──────────────────────────────────────────────────────────────

const ASSET_SPECS = [
  {
    type:  "HERO",
    dims:  "1600 × 720 px",
    ratio: "20:9",
    usage: "Main home hero banner",
    tips:  "Keep logos and subjects centered. Avoid text near edges.",
    accent: "from-violet-500/10 to-violet-500/5 border-violet-500/20 text-violet-300",
    dot:    "bg-violet-400",
  },
  {
    type:  "CARD",
    dims:  "800 × 450 px",
    ratio: "16:9",
    usage: "Event cards and spotlight cards",
    tips:  "Standard widescreen crop. Safe for most placements.",
    accent: "from-cyan-500/10 to-cyan-500/5 border-cyan-500/20 text-cyan-300",
    dot:    "bg-cyan-400",
  },
  {
    type:  "THUMBNAIL",
    dims:  "400 × 400 px",
    ratio: "1:1",
    usage: "Compact previews and square crops",
    tips:  "Square format — center the main subject.",
    accent: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 text-emerald-300",
    dot:    "bg-emerald-400",
  },
  {
    type:  "BANNER",
    dims:  "1600 × 500 px",
    ratio: "~3.2:1",
    usage: "Wide promotional or header visuals",
    tips:  "Keep key visuals within the center-horizontal third.",
    accent: "from-amber-500/10 to-amber-500/5 border-amber-500/20 text-amber-300",
    dot:    "bg-amber-400",
  },
] as const;

function AssetSpecsSection() {
  return (
    <AdminSectionCard
      title="Recommended Asset Specs"
      description="Reference dimensions for each asset type — upload is never blocked by size"
    >
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.07] mb-4">
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <p className="text-[11px] text-muted-foreground">
          These are editorial guidelines only. Any image can be uploaded — no dimension validation is enforced.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {ASSET_SPECS.map((spec) => (
          <div
            key={spec.type}
            data-testid={`spec-card-${spec.type.toLowerCase()}`}
            className={`flex flex-col gap-2 p-4 rounded-xl border bg-gradient-to-br ${spec.accent}`}
          >
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${spec.dot}`} />
              <span className="text-[11px] font-mono font-semibold tracking-widest uppercase">
                {spec.type}
              </span>
            </div>

            {/* Dims + ratio */}
            <div>
              <div className="text-sm font-bold text-white">{spec.dims}</div>
              <div className="text-[11px] font-mono text-muted-foreground mt-0.5">ratio {spec.ratio}</div>
            </div>

            {/* Usage */}
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{spec.usage}</p>

            {/* Tip */}
            <p className="text-[10px] text-muted-foreground/50 leading-relaxed border-t border-white/[0.06] pt-2">
              {spec.tips}
            </p>
          </div>
        ))}
      </div>
    </AdminSectionCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminMediaPage() {
  const [view, setView]           = useState<"grid" | "list">("grid");
  const [assetToDelete, setAssetToDelete] = useState<MediaAsset | null>(null);
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<LibraryResponse>({
    queryKey: ["/api/admin/media"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) =>
      apiRequest("DELETE", `/api/admin/media/${id}`),
    onSuccess: () => {
      toast({ title: "Image deleted", description: "The asset and all linked media references have been removed." });
      setAssetToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media/events"] });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      setAssetToDelete(null);
    },
  });

  const assets = data?.data ?? [];
  const total  = data?.total ?? 0;

  return (
    <PredictAdminLayout
      title="Media Library"
      subtitle="Upload and manage image assets for prediction events"
      breadcrumb="Media"
    >
      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        asset={assetToDelete}
        isPending={deleteMutation.isPending}
        onConfirm={() => assetToDelete && deleteMutation.mutate(assetToDelete.id)}
        onCancel={() => setAssetToDelete(null)}
      />

      {/* Upload section */}
      <AdminSectionCard
        title="Upload Image"
        description="Drag & drop or click to browse — jpeg · png · webp · svg · gif · max 10 MB"
      >
        <DropZone onSuccess={() => refetch()} />
      </AdminSectionCard>

      {/* Recommended specs */}
      <AssetSpecsSection />

      {/* Library */}
      <AdminSectionCard
        title={`Asset Library${total ? ` — ${total}` : ""}`}
        description="All uploaded images available for event attachment"
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${total} asset${total !== 1 ? "s" : ""}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              data-testid="button-refresh-library"
              onClick={() => refetch()}
              className="p-1.5 rounded border border-white/10 hover:border-white/25 text-muted-foreground hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid="button-view-grid"
              onClick={() => setView("grid")}
              className={`p-1.5 rounded border transition-colors ${view === "grid" ? "border-cyan-400/50 text-cyan-400 bg-cyan-400/10" : "border-white/10 text-muted-foreground hover:text-white"}`}
              title="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid="button-view-list"
              onClick={() => setView("list")}
              className={`p-1.5 rounded border transition-colors ${view === "list" ? "border-cyan-400/50 text-cyan-400 bg-cyan-400/10" : "border-white/10 text-muted-foreground hover:text-white"}`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* States */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading assets…</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center py-16 gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">Failed to load library</span>
          </div>
        )}

        {!isLoading && !isError && assets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40 gap-3">
            <FileImage className="w-10 h-10" />
            <p className="text-sm italic">No assets yet — upload the first one above</p>
          </div>
        )}

        {!isLoading && !isError && assets.length > 0 && view === "grid" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} onDeleteRequest={setAssetToDelete} />
            ))}
          </div>
        )}

        {!isLoading && !isError && assets.length > 0 && view === "list" && (
          <div className="space-y-2">
            {assets.map((a) => (
              <AssetRow key={a.id} asset={a} onDeleteRequest={setAssetToDelete} />
            ))}
          </div>
        )}
      </AdminSectionCard>
    </PredictAdminLayout>
  );
}
