import { useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Trash2, Globe, Lock } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useUpdateProfile, type PlayerPublicProfile } from "@/hooks/use-player-claim";
import { useToast } from "@/hooks/use-toast";

const socialLinkSchema = z.object({
  platform: z.string().min(1, "Platform required").max(50),
  url: z.string().url("Must be a valid URL"),
});

const schema = z.object({
  headline: z.string().max(120).optional(),
  bio: z.string().max(500).optional(),
  profileImageUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  bannerUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  teamAffiliation: z.string().max(128).optional(),
  socialLinks: z.array(socialLinkSchema).max(6).optional(),
});
type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: number;
  profile: PlayerPublicProfile | null;
}

export function EditPlayerProfileDialog({ open, onOpenChange, claimId, profile }: Props) {
  const { toast } = useToast();
  const updateProfile = useUpdateProfile();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      headline: profile?.headline ?? "",
      bio: profile?.bio ?? "",
      profileImageUrl: profile?.profileImageUrl ?? "",
      bannerUrl: profile?.bannerUrl ?? "",
      teamAffiliation: profile?.teamAffiliation ?? "",
      socialLinks: profile?.socialLinks ?? [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "socialLinks",
  });

  useEffect(() => {
    if (open && profile) {
      form.reset({
        headline: profile.headline ?? "",
        bio: profile.bio ?? "",
        profileImageUrl: profile.profileImageUrl ?? "",
        bannerUrl: profile.bannerUrl ?? "",
        teamAffiliation: profile.teamAffiliation ?? "",
        socialLinks: profile.socialLinks ?? [],
      });
    }
  }, [open, profile]);

  const handleSubmit = async (values: FormData) => {
    try {
      await updateProfile.mutateAsync({
        claimId,
        headline: values.headline || undefined,
        bio: values.bio || undefined,
        profileImageUrl: values.profileImageUrl || undefined,
        bannerUrl: values.bannerUrl || undefined,
        teamAffiliation: values.teamAffiliation || undefined,
        socialLinks: values.socialLinks,
      });
      toast({ title: "Profile updated", description: "Your public profile has been saved." });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0f14] border border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-primary" />
            Edit Public Profile
          </DialogTitle>
          <DialogDescription className="text-white/50 text-sm">
            These fields are visible to other users. Market data and rankings are managed by the platform.
          </DialogDescription>
        </DialogHeader>

        {/* Editable vs Protected notice */}
        <div className="flex gap-4 p-3 rounded-lg bg-black/30 border border-white/5 text-xs">
          <div className="flex items-center gap-2 text-emerald-400/70">
            <Globe className="w-3.5 h-3.5" />
            <span>Fields below are <strong>yours to control</strong></span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-white/30">
            <Lock className="w-3.5 h-3.5" />
            <span>Price, rankings, PVI — <strong>platform-managed, read-only</strong></span>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5 mt-2">
            {/* Headline */}
            <FormField control={form.control} name="headline" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Public Headline</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g. Mid laner · Team Alpha · LCS 2025"
                    className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Bio */}
            <FormField control={form.control} name="bio" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Bio</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder="Tell your story..."
                    className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 resize-none h-28"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Team */}
            <FormField control={form.control} name="teamAffiliation" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Current Team / Organization</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g. Team Alpha"
                    className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Profile Image */}
            <FormField control={form.control} name="profileImageUrl" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Profile Image URL</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="https://..."
                    className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Banner Image */}
            <FormField control={form.control} name="bannerUrl" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Banner Image URL</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="https://..."
                    className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Social Links */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-white/70 font-medium">Social Links</label>
                {fields.length < 6 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => append({ platform: "", url: "" })}
                    className="text-primary hover:text-primary/80 hover:bg-primary/10 gap-1.5 text-xs h-7"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add link
                  </Button>
                )}
              </div>
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <FormField control={form.control} name={`socialLinks.${index}.platform`} render={({ field }) => (
                    <FormItem className="w-32 shrink-0">
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Twitter"
                          className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 text-sm h-9"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`socialLinks.${index}.url`} render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://twitter.com/yourhandle"
                          className="bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 text-sm h-9"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    className="h-9 w-9 p-0 text-white/30 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              {fields.length === 0 && (
                <div className="text-xs text-white/30 italic">No social links added yet.</div>
              )}
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-white/60 hover:text-white">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateProfile.isPending}
                className="bg-primary hover:bg-primary/90 text-black font-semibold"
              >
                {updateProfile.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</>
                ) : (
                  "Save Profile"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
