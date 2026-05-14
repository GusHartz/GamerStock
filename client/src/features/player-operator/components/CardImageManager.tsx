import { useRef, forwardRef } from "react";
import { ImagePlus, Loader2, AlertCircle, CheckCircle2, Upload, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCardVisual, useUploadCardImage, useUpdateCardVisual } from "../hooks/use-operator";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    editing:   "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    preview:   "bg-blue-500/20 text-blue-300 border-blue-500/30",
    published: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  };
  return (
    <Badge className={cn("border text-xs capitalize", map[status] ?? "bg-white/10 text-white/50 border-white/20")}>
      {status}
    </Badge>
  );
}

interface Props {
  assetId: number;
}

export const CardImageManager = forwardRef<HTMLElement, Props>(function CardImageManager({ assetId }, ref) {
  const { data: cardVisual, isLoading, isError } = useCardVisual(assetId);
  const uploadMutation = useUploadCardImage(assetId);
  const updateMutation = useUpdateCardVisual(assetId);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadMutation.mutate(file, {
      onSuccess: () => toast({ title: "Image uploaded", description: "Your card image has been updated." }),
      onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
    });
  }

  function handlePublish() {
    updateMutation.mutate(
      { status: "published" },
      {
        onSuccess: () => toast({ title: "Card published", description: "Your card is now visible on the market." }),
        onError: (err: any) => toast({ title: "Publish failed", description: err.message, variant: "destructive" }),
      },
    );
  }

  const isUploading = uploadMutation.isPending;

  return (
    <section id="card-image-manager" ref={ref} className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Card Image</h2>
        <Badge className="bg-white/10 text-white/30 border border-white/10 text-xs">Beta</Badge>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        {isLoading && <div className="h-64 animate-pulse bg-white/5 rounded-lg" />}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4" />
            Failed to load card image.
          </div>
        )}

        {!isLoading && !isError && (
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {/* ── Image Preview ── */}
            <div className="relative shrink-0 w-[160px]">
              <div
                className="relative w-[160px] h-[213px] rounded-xl overflow-hidden border border-white/10 bg-white/5"
                style={{ aspectRatio: "3/4" }}
              >
                {cardVisual?.imageUrl ? (
                  <img
                    src={cardVisual.imageUrl}
                    alt="Card image"
                    className="absolute inset-0 w-full h-full object-cover"
                    data-testid="img-card-preview"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/20">
                    <ImagePlus className="w-8 h-8" />
                    <span className="text-[11px] text-center leading-tight px-3">No image yet</span>
                  </div>
                )}

                {/* Upload overlay on hover */}
                {!isUploading && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
                    data-testid="btn-upload-card-image-overlay"
                  >
                    <Upload className="w-6 h-6 text-white" />
                    <span className="text-[11px] text-white font-medium">Change Photo</span>
                  </button>
                )}

                {/* Uploading spinner overlay */}
                {isUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  </div>
                )}
              </div>

              {/* Status badge below preview */}
              {cardVisual && (
                <div className="mt-2 flex justify-center">
                  <StatusBadge status={cardVisual.status} />
                </div>
              )}
            </div>

            {/* ── Right side: actions + info ── */}
            <div className="flex flex-col gap-4 flex-1 pt-1">
              <div className="space-y-1">
                <p className="text-sm font-medium text-white/80">
                  {cardVisual?.imageUrl ? "Update your card photo" : "Upload your card photo"}
                </p>
                <p className="text-xs text-white/40 leading-relaxed">
                  Recommended: 1200&times;1600px (3:4 portrait)<br />
                  Supported formats: JPG, PNG, WEBP &middot; Max 10 MB
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  variant="outline"
                  className="w-full sm:w-auto border-white/20 text-white bg-white/5 hover:bg-white/10 gap-2"
                  data-testid="btn-upload-card-image"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {isUploading ? "Uploading…" : cardVisual?.imageUrl ? "Replace Photo" : "Upload Photo"}
                </Button>

                {cardVisual?.imageUrl && cardVisual.status !== "published" && (
                  <Button
                    onClick={handlePublish}
                    disabled={updateMutation.isPending}
                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                    data-testid="btn-publish-card"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )}
                    Publish Card
                  </Button>
                )}

                {uploadMutation.isSuccess && (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Image uploaded successfully
                  </span>
                )}
              </div>

              {cardVisual && (
                <p className="text-[11px] text-white/25">
                  Last updated: {new Date(cardVisual.lastUpdated).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-card-image-file"
        />
      </div>
    </section>
  );
});
