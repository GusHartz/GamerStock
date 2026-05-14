import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { TrendingUp, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

const requestSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Please enter a valid email address"),
  region: z.string().optional(),
  primaryGame: z.string().optional(),
  usernameInterest: z.string().optional(),
  note: z.string().optional(),
});

type RequestForm = z.infer<typeof requestSchema>;

export default function RequestAccessPage() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<RequestForm>({
    resolver: zodResolver(requestSchema),
    defaultValues: { fullName: "", email: "", region: "", primaryGame: "", usernameInterest: "", note: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: RequestForm) => {
      const res = await apiRequest("POST", "/api/access-requests", values);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to submit request");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="w-full max-w-md bg-secondary/50 border-white/10 backdrop-blur-xl text-center">
            <CardHeader>
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-white">Request Submitted</CardTitle>
              <CardDescription className="text-muted-foreground mt-2">
                Your access request is pending review. We'll be in touch once it's approved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8">
                  Back to Login
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
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
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
            <CardTitle className="text-2xl font-bold text-white">Request Access</CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Apply for early access to the GamerStock trading terminal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
                <FormField control={form.control} name="fullName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Full Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Your full name" {...field} data-testid="input-fullname" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Email Address *</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} data-testid="input-email" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="region" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Region</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-region" className="bg-black/20 border-white/10 text-white">
                            <SelectValue placeholder="Select region" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-[#1a1f2e] border-white/10">
                          <SelectItem value="na">North America</SelectItem>
                          <SelectItem value="euw">Europe West</SelectItem>
                          <SelectItem value="eune">Europe Nordic & East</SelectItem>
                          <SelectItem value="kr">Korea</SelectItem>
                          <SelectItem value="br">Brazil</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="primaryGame" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Primary Game</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-game" className="bg-black/20 border-white/10 text-white">
                            <SelectValue placeholder="Select game" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-[#1a1f2e] border-white/10">
                          <SelectItem value="lol">League of Legends</SelectItem>
                          <SelectItem value="valorant">Valorant</SelectItem>
                          <SelectItem value="cs2">CS2</SelectItem>
                          <SelectItem value="dota2">Dota 2</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="usernameInterest" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Desired Username / Handle</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. TraderPro99" {...field} data-testid="input-username" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Note (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell us why you're interested in GamerStock..."
                        {...field}
                        data-testid="textarea-note"
                        className="bg-black/20 border-white/10 text-white focus:border-primary/50 resize-none"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-5"
                  disabled={mutation.isPending}
                  data-testid="button-submit"
                >
                  {mutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </form>
            </Form>
            <div className="mt-5 text-center">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-white transition-colors">
                Already have an account? Log in
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
