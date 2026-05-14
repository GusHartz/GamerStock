import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { TrendingUp, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters")
    .regex(/[a-zA-Z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type ResetForm = z.infer<typeof schema>;

function getToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [success, setSuccess] = useState(false);
  const token = getToken();

  const { data: validation, isLoading: validating } = useQuery({
    queryKey: ["/api/auth/reset-password/validate", token],
    queryFn: async () => {
      if (!token) return { valid: false, message: "No token provided" };
      const res = await fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
      return res.json() as Promise<{ valid: boolean; message?: string }>;
    },
    enabled: !!token,
    retry: false,
  });

  const form = useForm<ResetForm>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: ResetForm) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token, password: values.password });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: () => setSuccess(true),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-secondary/50 border-white/10 text-center p-8">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">Invalid Reset Link</p>
          <p className="text-muted-foreground text-sm mb-6">No token was found in this URL. Please request a new reset link.</p>
          <Link href="/forgot-password"><Button className="bg-primary hover:bg-primary/90">Request Reset</Button></Link>
        </Card>
      </div>
    );
  }

  if (validating) {
    return (
      <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (validation && !validation.valid) {
    return (
      <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-secondary/50 border-white/10 text-center p-8">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">Reset Link Invalid</p>
          <p className="text-muted-foreground text-sm mb-6">{validation.message}</p>
          <Link href="/forgot-password"><Button className="bg-primary hover:bg-primary/90">Request a New Link</Button></Link>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="w-full max-w-md bg-secondary/50 border-white/10 text-center">
            <CardHeader>
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-white">Password Reset</CardTitle>
              <CardDescription className="text-muted-foreground mt-2">
                Your password has been updated. You can now log in with your new password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8">
                  Go to Login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <span className="text-xl font-bold text-white tracking-tight">GamerStock</span>
          </div>
        </div>
        <Card className="bg-secondary/50 border-white/10 backdrop-blur-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-white">Set New Password</CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Choose a strong password for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">New Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Minimum 8 characters" {...field} data-testid="input-password" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Confirm Password</FormLabel>
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
                  {mutation.isPending ? "Saving..." : "Set New Password"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
