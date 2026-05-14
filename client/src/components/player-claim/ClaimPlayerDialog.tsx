import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, UserCheck, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { usePlayerAssetSearch, useSubmitClaim, type PlayerAssetResult } from "@/hooks/use-player-claim";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

const schema = z.object({
  evidenceNote: z.string().max(1000).optional(),
});
type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClaimPlayerDialog({ open, onOpenChange }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerAssetResult | null>(null);
  const { toast } = useToast();
  const submitClaim = useSubmitClaim();

  const { data: searchData, isLoading: isSearching } = usePlayerAssetSearch(searchQuery);
  const results = searchData?.results ?? [];

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { evidenceNote: "" },
  });

  const handleSubmit = async (values: FormData) => {
    if (!selectedPlayer) return;
    try {
      await submitClaim.mutateAsync({
        assetId: selectedPlayer.id,
        assetUid: selectedPlayer.assetUid,
        evidenceNote: values.evidenceNote || undefined,
      });
      toast({ title: "Claim submitted", description: "Your request is now under review." });
      onOpenChange(false);
      setSelectedPlayer(null);
      setSearchQuery("");
      form.reset();
    } catch (err: any) {
      toast({ title: "Claim failed", description: err.message, variant: "destructive" });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedPlayer(null);
    setSearchQuery("");
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[#0d0f14] border border-white/10 text-white max-w-lg shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white flex items-center gap-2.5">
            <UserCheck className="w-5 h-5 text-primary" />
            Claim Player Profile
          </DialogTitle>
          <DialogDescription className="text-white/50 text-sm">
            Search for your name on GamerStock. Once found, submit your claim request for admin review.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5 mt-2">
            {/* Player Search */}
            <div className="space-y-2">
              <label className="text-sm text-white/70 font-medium">Find your player profile</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <Input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedPlayer(null);
                  }}
                  placeholder="Type your in-game name or alias..."
                  className="pl-9 bg-black/30 border-white/10 text-white placeholder:text-white/30 focus:border-primary/50"
                />
              </div>

              {/* Search Results */}
              {searchQuery.length >= 2 && (
                <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
                  {isSearching ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-white/50 text-sm">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Searching...
                    </div>
                  ) : results.length === 0 ? (
                    <div className="px-4 py-3 text-white/40 text-sm">
                      No players found for "{searchQuery}"
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {results.map((player) => (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => setSelectedPlayer(player)}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 text-left transition-all",
                            "hover:bg-white/5 group",
                            selectedPlayer?.id === player.id && "bg-primary/10 border-l-2 border-primary",
                          )}
                        >
                          <div>
                            <div className="text-sm font-semibold text-white">{player.displayName}</div>
                            <div className="text-xs text-white/40 mt-0.5">{player.symbol || player.entityType}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-primary font-mono">
                              {formatCurrency(parseFloat(player.lastTradePrice))}
                            </span>
                            <ChevronRight className={cn(
                              "w-4 h-4 transition-colors",
                              selectedPlayer?.id === player.id ? "text-primary" : "text-white/20 group-hover:text-white/40"
                            )} />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Selected Player Confirmation */}
              {selectedPlayer && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="text-sm text-emerald-300">
                    Selected: <span className="font-semibold text-white">{selectedPlayer.displayName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPlayer(null)}
                    className="ml-auto text-xs text-emerald-400/60 hover:text-emerald-300"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Evidence Note */}
            <FormField
              control={form.control}
              name="evidenceNote"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Additional information (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Add links to your social profiles, team pages, or any other information that helps verify your identity..."
                      className="bg-black/30 border-white/10 text-white placeholder:text-white/30 focus:border-primary/50 resize-none h-24"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Disclaimer */}
            <div className="flex gap-2.5 p-3 rounded-lg bg-white/5 border border-white/5">
              <AlertCircle className="w-4 h-4 text-amber-400/70 shrink-0 mt-0.5" />
              <p className="text-xs text-white/40 leading-relaxed">
                Claiming a profile grants you control over your public bio, headline, and social links only.
                Market data, pricing, rankings, and performance scores are managed by the platform.
              </p>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={handleClose} className="text-white/60 hover:text-white">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!selectedPlayer || submitClaim.isPending}
                className="bg-primary hover:bg-primary/90 text-black font-semibold"
              >
                {submitClaim.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Submitting...</>
                ) : (
                  "Submit Claim"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
