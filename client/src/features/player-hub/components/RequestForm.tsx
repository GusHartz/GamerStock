import { useState } from "react";
import { PlusCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSubmitAssetRequest } from "../hooks/use-player-hub";

const GAMES = [
  { id: "lol",      label: "League of Legends" },
  { id: "dota2",    label: "Dota 2"            },
  { id: "cs2",      label: "CS2"               },
  { id: "valorant", label: "Valorant"           },
  { id: "r6",       label: "Rainbow Six"        },
];

const PLATFORMS = [
  { id: "riot",       label: "Riot Games" },
  { id: "steam",      label: "Steam"      },
  { id: "faceit",     label: "FACEIT"     },
  { id: "battlenet",  label: "Battle.net" },
  { id: "other",      label: "Other"      },
];

export function RequestForm() {
  const { toast } = useToast();
  const mutation = useSubmitAssetRequest();
  const [open, setOpen] = useState(false);

  const [gameId, setGameId] = useState("");
  const [platform, setPlatform] = useState("");
  const [externalUsername, setExternalUsername] = useState("");
  const [externalAccountRef, setExternalAccountRef] = useState("");
  const [externalProfileUrl, setExternalProfileUrl] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gameId || !platform) {
      toast({ title: "Missing fields", description: "Game and platform are required.", variant: "destructive" });
      return;
    }
    mutation.mutate(
      {
        gameId,
        platform,
        externalUsername: externalUsername || undefined,
        externalAccountRef: externalAccountRef || undefined,
        externalProfileUrl: externalProfileUrl || undefined,
        requestedAssetType: "pro_player_card",
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Request submitted", description: "Our team will review your request." });
          setOpen(false);
          setGameId("");
          setPlatform("");
          setExternalUsername("");
          setExternalAccountRef("");
          setExternalProfileUrl("");
          setNotes("");
        },
        onError: (err: any) => {
          toast({ title: "Submission failed", description: err.message, variant: "destructive" });
        },
      },
    );
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        className="border-white/20 text-white/70 hover:bg-white/5 gap-2"
        onClick={() => setOpen(true)}
        data-testid="btn-open-request-form"
      >
        <PlusCircle className="w-4 h-4" />
        Request Missing Asset
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4"
      data-testid="asset-request-form"
    >
      <h3 className="text-sm font-semibold text-white">Request a Missing Asset</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-white/60">Game *</Label>
          <Select value={gameId} onValueChange={setGameId}>
            <SelectTrigger className="bg-white/5 border-white/20 text-white" data-testid="select-game">
              <SelectValue placeholder="Select game" />
            </SelectTrigger>
            <SelectContent>
              {GAMES.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-white/60">Platform *</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="bg-white/5 border-white/20 text-white" data-testid="select-platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-white/60">In-game Username</Label>
          <Input
            value={externalUsername}
            onChange={(e) => setExternalUsername(e.target.value)}
            placeholder="e.g. PlayerX#1234"
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            data-testid="input-external-username"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-white/60">Account ID / Reference</Label>
          <Input
            value={externalAccountRef}
            onChange={(e) => setExternalAccountRef(e.target.value)}
            placeholder="PUUID, Steam ID, etc."
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            data-testid="input-external-account-ref"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs text-white/60">Profile URL (optional)</Label>
          <Input
            value={externalProfileUrl}
            onChange={(e) => setExternalProfileUrl(e.target.value)}
            placeholder="https://..."
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            data-testid="input-profile-url"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs text-white/60">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why should this asset be added? Any context for the team."
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30 resize-none"
            rows={3}
            data-testid="textarea-notes"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="bg-white text-black hover:bg-white/90 gap-2"
          data-testid="btn-submit-request"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Submit Request
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-white/50 hover:text-white"
          onClick={() => setOpen(false)}
          data-testid="btn-cancel-request"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
