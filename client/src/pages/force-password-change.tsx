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
import { useLocation } from "wouter";
import { ShieldAlert } from "lucide-react";
import logoImg from "@assets/ChatGPT_Image_3_de_mar._de_2026__11_48_14-removebg-preview_1773185791880.png";
import { motion } from "framer-motion";

const schema = z.object({
  newPassword: z.string().min(8, "Must be at least 8 characters")
    .regex(/[a-zA-Z]/, "Must contain at least one letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type ChangeForm = z.infer<typeof schema>;

export default function ForcePasswordChangePage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const form = useForm<ChangeForm>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: ChangeForm) => {
      const res = await apiRequest("POST", "/api/auth/force-change-password", {
        newPassword: values.newPassword,
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Password updated", description: "Your password has been set. Welcome to GamerStock!" });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
      navigate("/home");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <img src={logoImg} alt="GamerStock" className="h-8 w-auto object-contain" />
        </div>
        <Card className="bg-secondary/50 border-white/10 backdrop-blur-xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                <ShieldAlert className="w-6 h-6 text-amber-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-white">Set Your Password</CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Your account requires a new password before you can continue. Please choose a secure password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
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
                <p className="text-xs text-muted-foreground">Must be at least 8 characters with a letter and a number.</p>
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-5"
                  disabled={mutation.isPending}
                  data-testid="button-submit"
                >
                  {mutation.isPending ? "Saving..." : "Set Password & Continue"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
