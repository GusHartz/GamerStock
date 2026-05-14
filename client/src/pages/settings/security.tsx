import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { SettingsLayout } from "./settings-layout";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Must be at least 8 characters")
    .regex(/[a-zA-Z]/, "Must contain at least one letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type ChangeForm = z.infer<typeof schema>;

export default function SecuritySettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);

  const form = useForm<ChangeForm>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: ChangeForm) => {
      const res = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      form.reset();
      setDone(true);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <SettingsLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
          <KeyRound className="w-6 h-6 text-primary" />
          Security
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your account security and password.</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="bg-secondary/40 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg">Change Password</CardTitle>
            <CardDescription>
              Use a strong password with at least 8 characters, a letter, and a number.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-sm">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Password changed successfully.
                <button className="ml-auto text-xs text-emerald-400/70 hover:text-emerald-300" onClick={() => setDone(false)}>Change again</button>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
                  <FormField control={form.control} name="currentPassword" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Current Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your current password" {...field} data-testid="input-current-password" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="newPassword" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Minimum 8 characters" {...field} data-testid="input-new-password" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Confirm New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Repeat new password" {...field} data-testid="input-confirm-password" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button
                    type="submit"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    disabled={mutation.isPending}
                    data-testid="button-save"
                  >
                    {mutation.isPending ? "Saving..." : "Update Password"}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </SettingsLayout>
  );
}
