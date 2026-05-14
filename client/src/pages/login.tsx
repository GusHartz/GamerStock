import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, AlertCircle } from "lucide-react";
import logoImg from "@assets/ChatGPT_Image_3_de_mar._de_2026__11_48_14-removebg-preview_1773185791880.png";

const loginSchema = z.object({
  email: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [, navigate] = useLocation();
  const [errorMsg, setErrorMsg] = useState("");
  const queryClient = useQueryClient();

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (values: LoginForm) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...values, email: values.email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Login failed");
      return data;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
      console.log("LOGIN SUCCESS → redirecting");
      navigate("/home");
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  return (
    <div className="min-h-screen bg-[#0A0E17] flex flex-col md:flex-row font-sans overflow-hidden">
      {/* Left branding panel */}
      <div className="relative w-full md:w-1/2 min-h-[40vh] md:min-h-screen flex flex-col justify-center p-8 lg:p-16 border-b md:border-b-0 md:border-r border-white/10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-[#0A0E17]/80 to-[#0A0E17] -z-10 blur-3xl"></div>
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full mix-blend-screen filter blur-[100px] opacity-50 animate-pulse"></div>

        <div className="relative z-10">
          <div className="flex items-center mb-12">
            <img src={logoImg} alt="GamerStock" className="h-10 w-auto object-contain" />
          </div>

          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold text-white leading-[1.1] mb-6">
              The First Market for <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
                Esports Performance
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md leading-relaxed">
              Trade shares of top League of Legends players based on their live performance.
            </p>
          </div>
        </div>
      </div>

      {/* Right login panel */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8 bg-[#0A0E17] relative">
        <div className="w-full max-w-md glass-panel p-10 rounded-3xl relative z-10 shadow-2xl shadow-black">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <Lock className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-3xl font-display font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-muted-foreground text-sm">
              No account?{" "}
              <Link href="/signup" className="text-primary hover:underline">
                Sign up free
              </Link>
            </p>
          </div>

          <form
            onSubmit={form.handleSubmit((d) => {
              setErrorMsg("");
              loginMutation.mutate(d);
            })}
            className="space-y-5"
          >
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Email or Username</label>
              <input
                {...form.register("email")}
                type="text"
                placeholder="you@example.com or GamerStock2002"
                autoComplete="username email"
                data-testid="input-email"
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all font-mono"
              />
              {form.formState.errors.email && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Password</label>
              <input
                {...form.register("password")}
                type="password"
                placeholder="Enter password"
                autoComplete="current-password"
                data-testid="input-password"
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all font-mono"
              />
              {form.formState.errors.password && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.password.message}</p>
              )}
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              data-testid="button-signin"
              className="w-full py-4 px-6 rounded-xl font-bold text-base bg-primary hover:bg-primary/90 text-black hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 shadow-xl shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {loginMutation.isPending ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 flex items-center text-xs text-muted-foreground">
            <Link href="/forgot-password" className="hover:text-white transition-colors">
              Forgot password?
            </Link>
          </div>

          <div className="mt-4 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              System Status: Operational
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
