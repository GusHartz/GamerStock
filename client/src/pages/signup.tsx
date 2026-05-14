import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, AlertCircle } from "lucide-react";
import logoImg from "@assets/ChatGPT_Image_3_de_mar._de_2026__11_48_14-removebg-preview_1773185791880.png";


const signupSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    displayName: z
      .string()
      .min(2, "Display name must be at least 2 characters")
      .max(20, "Display name must be 20 characters or less"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [, navigate] = useLocation();
  const [errorMsg, setErrorMsg] = useState("");
  const queryClient = useQueryClient();

  const form = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      displayName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (values: SignupForm) => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...values, gamesSelected: [], gamesOther: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Signup failed");
      return data;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
      console.log("SIGNUP SUCCESS → redirecting");
      navigate("/home");
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  return (
    <div className="min-h-screen bg-[#0A0E17] flex flex-col md:flex-row font-sans overflow-hidden">
      {/* Left branding panel */}
      <div className="relative w-full md:w-5/12 min-h-[30vh] md:min-h-screen flex flex-col justify-center p-8 lg:p-16 border-b md:border-b-0 md:border-r border-white/10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-[#0A0E17]/80 to-[#0A0E17] -z-10 blur-3xl"></div>
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full mix-blend-screen filter blur-[100px] opacity-50 animate-pulse"></div>

        <div className="relative z-10">
          <div className="flex items-center mb-12">
            <img src={logoImg} alt="GamerStock" className="h-10 w-auto object-contain" />
          </div>

          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold text-white leading-[1.1] mb-6">
              Join the First Market for{" "}
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
                Esports Performance
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md leading-relaxed">
              Trade shares of top esports players based on their live performance. Start with virtual currency.
            </p>
          </div>
        </div>
      </div>

      {/* Right signup panel */}
      <div className="w-full md:w-7/12 flex items-center justify-center p-6 md:p-8 bg-[#0A0E17] relative overflow-y-auto">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02]"></div>

        <div className="w-full max-w-lg glass-panel p-8 md:p-10 rounded-3xl relative z-10 shadow-2xl shadow-black my-6">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <UserPlus className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-3xl font-display font-bold text-white mb-2">Create Account</h2>
            <p className="text-muted-foreground text-sm">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>

          <form
            onSubmit={form.handleSubmit((d) => {
              setErrorMsg("");
              signupMutation.mutate(d);
            })}
            className="space-y-4"
          >
            {/* Name + Display Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Name</label>
                <input
                  {...form.register("name")}
                  type="text"
                  placeholder="Your name"
                  autoComplete="name"
                  data-testid="input-name"
                  className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-sm"
                />
                {form.formState.errors.name && (
                  <p className="text-destructive text-xs mt-1">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Display Name</label>
                <input
                  {...form.register("displayName")}
                  type="text"
                  placeholder="Shown in-app"
                  data-testid="input-display-name"
                  className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-sm"
                />
                {form.formState.errors.displayName && (
                  <p className="text-destructive text-xs mt-1">{form.formState.errors.displayName.message}</p>
                )}
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">Email</label>
              <input
                {...form.register("email")}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                data-testid="input-email"
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-sm"
              />
              {form.formState.errors.email && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.email.message}</p>
              )}
            </div>

            {/* Password + Confirm row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Password</label>
                <input
                  {...form.register("password")}
                  type="password"
                  placeholder="Min 8 characters"
                  autoComplete="new-password"
                  data-testid="input-password"
                  className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-sm"
                />
                {form.formState.errors.password && (
                  <p className="text-destructive text-xs mt-1">{form.formState.errors.password.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Confirm</label>
                <input
                  {...form.register("confirmPassword")}
                  type="password"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  data-testid="input-confirm-password"
                  className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-sm"
                />
                {form.formState.errors.confirmPassword && (
                  <p className="text-destructive text-xs mt-1">{form.formState.errors.confirmPassword.message}</p>
                )}
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={signupMutation.isPending}
              data-testid="button-signup"
              className="w-full py-4 px-6 rounded-xl font-bold text-base bg-primary hover:bg-primary/90 text-black hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 shadow-xl shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {signupMutation.isPending ? "Creating account..." : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
