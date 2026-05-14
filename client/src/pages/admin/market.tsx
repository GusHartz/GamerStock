import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "./layout";
import { Play, Pause, Activity, Zap, Clock, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Globe, Layers, Brain, HeartPulse, Key, Eye, EyeOff, Wifi, WifiOff, Bot, Users, TrendingUp, BarChart2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SimulatorStatus = { paused: boolean };
type SyncResult = { success: boolean; inserted: number; updated: number; total: number; message?: string };
type MarketModeData = { mode: "REAL_RIOT_NA1" | "SANDBOX" };
type RiotStatus = {
  riotAssetsCount: number;
  matchesProcessed: number;
  perfJob: { running: boolean; lastRunAt: string | null; lastRunProcessed: number; lastRunErrors: number };
};

type SystemHealth = {
  playersSynced: number;
  matchesCached: number;
  perfJobRunning: boolean;
  lastPerfRun: string | null;
  totalTrades: number;
  env: string;
  riotApiKeyPresent: boolean;
  uptime: number;
};

type RiotKeyStatus = {
  configured: boolean;
  source: "admin" | "env" | "none";
  hasAdminKey: boolean;
  hasEnvKey: boolean;
  keyPreview: string | null;
  lastTestedAt: string | null;
  lastTestValid: boolean | null;
  lastTestError: string | null;
  lastTestSource: string | null;
  lastTestKeyPreview: string | null;
};
type RiotTestResult = {
  valid: boolean;
  error?: string;
  source?: string;
  keyPreview?: string;
  urlTested?: string;
  riotStatus?: number;
  riotMessage?: string;
};

type BotStatus = {
  running: boolean;
  botCount: number;
  tradesPerHour: number;
  totalBotVolume24h: number;
  intervalMs: number;
  batchSizeMin: number;
  batchSizeMax: number;
  message?: string;
};

export default function AdminMarketPage() {
  const { toast } = useToast();
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<RiotTestResult | null>(null);
  const [botIntervalInput, setBotIntervalInput] = useState("");
  const [botBatchMinInput, setBotBatchMinInput] = useState("");
  const [botBatchMaxInput, setBotBatchMaxInput] = useState("");

  const { data, isLoading } = useQuery<SimulatorStatus>({
    queryKey: ["/api/admin/simulator"],
    refetchInterval: 5000,
  });

  const { data: marketModeData, isLoading: modeLoading } = useQuery<MarketModeData>({
    queryKey: ["/api/admin/market-mode"],
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/simulator/pause"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulator"] });
      toast({ title: "Simulator paused" });
    },
    onError: () => toast({ title: "Failed to pause simulator", variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/simulator/resume"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulator"] });
      toast({ title: "Simulator resumed" });
    },
    onError: () => toast({ title: "Failed to resume simulator", variant: "destructive" }),
  });

  const marketModeMutation = useMutation({
    mutationFn: async (mode: "REAL_RIOT_NA1" | "SANDBOX") => {
      const res = await apiRequest("POST", "/api/admin/market-mode", { mode });
      return res.json() as Promise<MarketModeData>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/terminal/market"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/assets"] });
      toast({ title: `Market mode set to ${data.mode}` });
    },
    onError: () => toast({ title: "Failed to update market mode", variant: "destructive" }),
  });

  const { data: riotStatus } = useQuery<RiotStatus>({
    queryKey: ["/api/admin/riot/status"],
    refetchInterval: 15000,
  });

  const { data: sysHealth, refetch: refetchHealth } = useQuery<SystemHealth>({
    queryKey: ["/api/admin/system"],
    refetchInterval: 15000,
  });

  const riotSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/riot/sync/challenger-na1");
      return res.json() as Promise<SyncResult>;
    },
    onSuccess: (data) => {
      setLastSync(data);
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/riot/players"] });
        queryClient.invalidateQueries({ queryKey: ["/api/terminal/market"] });
        queryClient.invalidateQueries({ queryKey: ["/api/market/assets"] });
        toast({ title: `Riot sync complete — ${data.total} players synced` });
      } else {
        toast({ title: data.message || "Sync failed", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      setLastSync({ success: false, inserted: 0, updated: 0, total: 0, message: err.message });
      toast({ title: "Riot sync failed", variant: "destructive" });
    },
  });

  const perfJobMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/riot/perf/run");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Performance pricing job started", description: "Runs in background. Check status in ~2 min." });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/admin/riot/status"] }), 3000);
    },
    onError: (err: any) => toast({ title: "Failed to start perf job", description: err.message, variant: "destructive" }),
  });

  const { data: riotKeyStatus, refetch: refetchKeyStatus } = useQuery<RiotKeyStatus>({
    queryKey: ["/api/admin/riot/key/status"],
    queryFn: () => fetch("/api/admin/riot/key/status").then(r => r.json()),
    staleTime: 30_000,
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const sanitized = apiKey.replace(/[\s\r\n]+/g, "");
      const res = await apiRequest("POST", "/api/admin/riot/key", { apiKey: sanitized });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Save failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "API key saved", description: `Active key: ${data.keyPreview}` });
      setApiKeyInput("");
      setTestResult(null);
      refetchKeyStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system"] });
    },
    onError: (err: any) => toast({ title: "Failed to save API key", description: err.message, variant: "destructive" }),
  });

  const testKeyMutation = useMutation({
    mutationFn: async () => {
      // If there's a key typed in the input, test that inline without saving first
      const body = apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {};
      const res = await apiRequest("POST", "/api/admin/riot/test", body);
      return res.json() as Promise<RiotTestResult>;
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.valid) {
        toast({ title: "✅ Riot API Connected", description: `Key is valid — source: ${data.source ?? "saved"}` });
        refetchKeyStatus();
      } else {
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: any) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const { data: botStatus, refetch: refetchBots } = useQuery<BotStatus>({
    queryKey: ["/api/admin/bots/status"],
    refetchInterval: 5000,
  });

  const startBotsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/bots/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bots/status"] });
      toast({ title: "Bot traders started" });
    },
    onError: () => toast({ title: "Failed to start bots", variant: "destructive" }),
  });

  const stopBotsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/bots/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bots/status"] });
      toast({ title: "Bot traders stopped" });
    },
    onError: () => toast({ title: "Failed to stop bots", variant: "destructive" }),
  });

  const seedBotsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/bots/seed");
      return res.json() as Promise<{ seeded: number; message: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bots/status"] });
      toast({ title: `Bots seeded: ${data.message}` });
    },
    onError: () => toast({ title: "Failed to seed bots", variant: "destructive" }),
  });

  const botConfigMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, number> = {};
      if (botIntervalInput) body.intervalMs = parseInt(botIntervalInput);
      if (botBatchMinInput) body.batchSizeMin = parseInt(botBatchMinInput);
      if (botBatchMaxInput) body.batchSizeMax = parseInt(botBatchMaxInput);
      const res = await apiRequest("POST", "/api/admin/bots/config", body);
      return res.json() as Promise<BotStatus>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bots/status"] });
      setBotIntervalInput("");
      setBotBatchMinInput("");
      setBotBatchMaxInput("");
      toast({ title: "Bot config updated" });
    },
    onError: () => toast({ title: "Failed to update bot config", variant: "destructive" }),
  });

  const isPaused = data?.paused ?? false;
  const isActing = pauseMutation.isPending || resumeMutation.isPending;
  const currentMode = marketModeData?.mode ?? "REAL_RIOT_NA1";

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6 max-w-2xl">

        {/* Market Mode Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-blue-500/15">
              <Globe className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="font-semibold text-white">Market Mode</div>
              <div className="text-sm text-muted-foreground">Controls which asset universe the terminal displays</div>
            </div>
          </div>

          <div className="bg-white/3 rounded-xl border border-white/5 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Active Mode</span>
              {modeLoading ? (
                <div className="h-5 w-32 bg-white/5 animate-pulse rounded" />
              ) : (
                <span
                  data-testid="market-mode-badge"
                  className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                    currentMode === "REAL_RIOT_NA1"
                      ? "bg-violet-500/15 text-violet-300 border-violet-500/20"
                      : "bg-amber-500/15 text-amber-300 border-amber-500/20"
                  }`}
                >
                  {currentMode === "REAL_RIOT_NA1" ? "REAL · NA1 Challenger" : "SANDBOX · Fictional"}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Switch Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => marketModeMutation.mutate("REAL_RIOT_NA1")}
                  disabled={marketModeMutation.isPending || currentMode === "REAL_RIOT_NA1"}
                  data-testid="button-mode-real"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    currentMode === "REAL_RIOT_NA1"
                      ? "bg-violet-600 text-white"
                      : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 border border-white/10"
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  REAL_RIOT_NA1
                </button>
                <button
                  onClick={() => marketModeMutation.mutate("SANDBOX")}
                  disabled={marketModeMutation.isPending || currentMode === "SANDBOX"}
                  data-testid="button-mode-sandbox"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    currentMode === "SANDBOX"
                      ? "bg-amber-500 text-black"
                      : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 border border-white/10"
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  SANDBOX
                </button>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-white">REAL_RIOT_NA1</strong> — Terminal shows 300 real NA1 Challenger players from Riot API with simulated pricing.{" "}
            <strong className="text-white">SANDBOX</strong> — Terminal shows 1,000 fictional players with synthetic data.
          </p>
        </div>

        {/* Simulator Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${isPaused ? "bg-amber-500/15" : "bg-emerald-500/15"}`}>
                <Activity className={`w-5 h-5 ${isPaused ? "text-amber-400" : "text-emerald-400"}`} />
              </div>
              <div>
                <div className="font-semibold text-white">Market Activity Simulator</div>
                <div className="text-sm text-muted-foreground">Automated market maker bot</div>
              </div>
            </div>
            {!isLoading && (
              <motion.div
                key={isPaused ? "paused" : "running"}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${isPaused ? "bg-amber-500/15 text-amber-400 border-amber-500/20" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"}`}
                data-testid="simulator-status"
              >
                {isPaused ? (
                  <><Pause className="w-3 h-3" /> Paused</>
                ) : (
                  <><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Running</>
                )}
              </motion.div>
            )}
          </div>

          <div className="bg-white/3 rounded-xl border border-white/5 p-4 grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">Interval</span>
              </div>
              <div className="font-mono text-white font-semibold">15s</div>
            </div>
            <div className="text-center border-x border-white/5">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                <Zap className="w-3.5 h-3.5" />
                <span className="text-xs">Liquidity</span>
              </div>
              <div className="font-mono text-white font-semibold">
                {currentMode === "REAL_RIOT_NA1" ? "25,000" : "10,000"}
              </div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                <Activity className="w-3.5 h-3.5" />
                <span className="text-xs">Fee</span>
              </div>
              <div className="font-mono text-white font-semibold">2%</div>
            </div>
          </div>

          {isPaused && (
            <div className="flex items-start gap-2.5 text-sm p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>The market simulator is currently paused. Prices will not update automatically until it is resumed.</span>
            </div>
          )}

          <div className="flex gap-3">
            {isPaused ? (
              <button
                onClick={() => resumeMutation.mutate()}
                disabled={isActing || isLoading}
                data-testid="button-resume-simulator"
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                Resume Simulator
              </button>
            ) : (
              <button
                onClick={() => pauseMutation.mutate()}
                disabled={isActing || isLoading}
                data-testid="button-pause-simulator"
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Pause className="w-4 h-4" />
                Pause Simulator
              </button>
            )}
          </div>
        </div>

        {/* Riot API Key Management Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-amber-500/15">
                <Key className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="font-semibold text-white">Riot API Key Management</div>
                <div className="text-sm text-muted-foreground">Update or validate the Riot API key used for sync</div>
              </div>
            </div>
            {/* Connection status badge — shows live test result or last known state */}
            <div data-testid="riot-key-status-badge">
              {riotKeyStatus == null ? null : !riotKeyStatus.configured ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">
                  <WifiOff className="w-3.5 h-3.5" /> Not Configured
                </span>
              ) : testResult?.valid === true ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                  <Wifi className="w-3.5 h-3.5" /> Connected
                </span>
              ) : testResult?.valid === false ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">
                  <WifiOff className="w-3.5 h-3.5" /> Invalid
                </span>
              ) : riotKeyStatus.lastTestValid === true ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                </span>
              ) : riotKeyStatus.lastTestValid === false ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">
                  <WifiOff className="w-3.5 h-3.5" /> Last Test Failed
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-700/60 text-zinc-300 border border-zinc-600/30">
                  <Key className="w-3.5 h-3.5" /> Not Tested
                </span>
              )}
            </div>
          </div>

          {/* Key source + status info table */}
          <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4 space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Active source</span>
              <span className="font-mono text-xs text-white" data-testid="riot-key-source">
                {riotKeyStatus == null ? "—" : riotKeyStatus.source === "admin" ? "Admin (DB)" : riotKeyStatus.source === "env" ? "Environment (RIOT_API_KEY)" : "None"}
              </span>
            </div>
            {riotKeyStatus?.keyPreview && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Active key</span>
                <span className="font-mono text-white/70 text-xs" data-testid="riot-key-preview">{riotKeyStatus.keyPreview}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Admin key saved</span>
              <span className={`text-xs font-medium ${riotKeyStatus?.hasAdminKey ? "text-emerald-400" : "text-muted-foreground"}`}>
                {riotKeyStatus == null ? "—" : riotKeyStatus.hasAdminKey ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Env key present</span>
              <span className={`text-xs font-medium ${riotKeyStatus?.hasEnvKey ? "text-sky-400" : "text-muted-foreground"}`}>
                {riotKeyStatus == null ? "—" : riotKeyStatus.hasEnvKey ? "Yes (RIOT_API_KEY)" : "No"}
              </span>
            </div>
            {(riotKeyStatus?.lastTestedAt || testResult) && (
              <div className="flex justify-between items-center pt-1 border-t border-white/5 mt-1">
                <span className="text-muted-foreground">Last tested</span>
                <span className="text-xs text-muted-foreground" data-testid="riot-last-tested">
                  {testResult
                    ? "Just now"
                    : riotKeyStatus?.lastTestedAt
                      ? new Date(riotKeyStatus.lastTestedAt).toLocaleTimeString()
                      : "—"}
                </span>
              </div>
            )}
            {(testResult?.error ?? riotKeyStatus?.lastTestError) && (
              <div className="flex justify-between items-start pt-1 border-t border-white/5 mt-1 gap-4">
                <span className="text-muted-foreground shrink-0">Last error</span>
                <span className="text-xs text-red-300 text-right" data-testid="riot-last-error">
                  {testResult?.error ?? riotKeyStatus?.lastTestError}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">New API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="RGAPI-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  className="bg-white/5 border-white/10 text-white font-mono text-sm pr-10"
                  data-testid="input-riot-api-key"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                  data-testid="button-toggle-key-visibility"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              <Button
                onClick={() => saveKeyMutation.mutate(apiKeyInput)}
                disabled={saveKeyMutation.isPending || !apiKeyInput.replace(/\s/g, "").startsWith("RGAPI-")}
                className="bg-amber-500 hover:bg-amber-400 text-black font-semibold"
                data-testid="button-save-riot-key"
              >
                {saveKeyMutation.isPending ? "Saving..." : "Save Key"}
              </Button>
              <Button
                variant="outline"
                onClick={() => testKeyMutation.mutate()}
                disabled={testKeyMutation.isPending}
                className="border-white/20 text-white hover:bg-white/10"
                data-testid="button-test-riot-connection"
                title={apiKeyInput.trim() ? "Test the key typed above (without saving)" : "Test the currently saved key"}
              >
                {testKeyMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Testing...</>
                ) : (
                  <><Wifi className="w-4 h-4 mr-2" /> {apiKeyInput.trim() ? "Test Typed Key" : "Test Connection"}</>
                )}
              </Button>
            </div>
            {apiKeyInput.trim() && (
              <p className="text-xs text-amber-400/80 mt-0.5">
                "Test Typed Key" will test the key above without saving it. Click "Save Key" to persist it.
              </p>
            )}
          </div>

          {testResult && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col gap-2 p-3 rounded-lg border text-sm ${testResult.valid ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"}`}
              data-testid="riot-test-result"
            >
              <div className="flex items-start gap-2.5">
                {testResult.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Riot API Connected — key is valid
                      {testResult.source === "inline" && <span className="text-emerald-400/70 ml-1">(typed key, not yet saved)</span>}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{testResult.error}</span>
                  </>
                )}
              </div>
              {/* Raw diagnostic info */}
              {(testResult.riotStatus != null || testResult.urlTested) && (
                <div className="bg-black/20 rounded px-2.5 py-1.5 text-xs font-mono space-y-0.5 opacity-80">
                  {testResult.urlTested && <div className="text-white/50">url: {testResult.urlTested}</div>}
                  {testResult.riotStatus != null && (
                    <div>
                      <span className="text-white/50">status: </span>
                      <span className={testResult.riotStatus === 200 ? "text-emerald-400" : "text-red-300"}>{testResult.riotStatus}</span>
                      {testResult.riotMessage && <span className="text-white/50 ml-2">"{testResult.riotMessage}"</span>}
                    </div>
                  )}
                  {testResult.keyPreview && <div className="text-white/50">key: {testResult.keyPreview} (source: {testResult.source})</div>}
                </div>
              )}
            </motion.div>
          )}

          <p className="text-xs text-muted-foreground">
            Admin-saved key takes priority over the <code className="text-white/50">RIOT_API_KEY</code> environment variable.
            Riot personal development keys expire every <strong className="text-white/60">24 hours</strong> — regenerate at{" "}
            <a href="https://developer.riotgames.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">developer.riotgames.com</a>.
          </p>
        </div>

        {/* Riot API Sync Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-violet-500/15">
              <RefreshCw className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <div className="font-semibold text-white">Riot API — NA1 Challenger Sync</div>
              <div className="text-sm text-muted-foreground">Fetch live Challenger Solo/Duo leaderboard into riot_assets</div>
            </div>
          </div>

          <div className="bg-white/3 rounded-xl border border-white/5 p-4 text-sm text-muted-foreground space-y-1.5">
            <div className="flex justify-between">
              <span>Endpoint</span>
              <span className="font-mono text-white/60 text-xs">lol/league/v4/challengerleagues/by-queue</span>
            </div>
            <div className="flex justify-between">
              <span>Platform</span>
              <span className="font-mono text-white/60">NA1</span>
            </div>
            <div className="flex justify-between">
              <span>Queue</span>
              <span className="font-mono text-white/60">RANKED_SOLO_5x5</span>
            </div>
            <div className="flex justify-between">
              <span>Auto-sync</span>
              <span className="font-mono text-white/60">Every 24 hours</span>
            </div>
          </div>

          {lastSync && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm ${lastSync.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"}`}
              data-testid="riot-sync-result"
            >
              {lastSync.success ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {lastSync.success ? (
                <span>
                  Sync complete — <strong>{lastSync.total}</strong> players total
                  ({lastSync.inserted} new, {lastSync.updated} updated)
                </span>
              ) : (
                <span>{lastSync.message || "Sync failed"}</span>
              )}
            </motion.div>
          )}

          <button
            onClick={() => riotSyncMutation.mutate()}
            disabled={riotSyncMutation.isPending}
            data-testid="button-riot-sync"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit"
          >
            <RefreshCw className={`w-4 h-4 ${riotSyncMutation.isPending ? "animate-spin" : ""}`} />
            {riotSyncMutation.isPending ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {/* P1 Dynamic Pricing Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-blue-500/15">
              <Brain className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="font-semibold text-white">P1 Dynamic Pricing</div>
              <div className="text-sm text-muted-foreground">Match-performance EMA pricing (runs every 10 min)</div>
            </div>
          </div>

          <div className="bg-white/3 rounded-xl border border-white/5 p-4 grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Assets</div>
              <div className="font-mono text-white font-semibold">{riotStatus?.riotAssetsCount ?? "–"}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Matches Cached</div>
              <div className="font-mono text-white font-semibold">{riotStatus?.matchesProcessed ?? "–"}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Last Batch</div>
              <div className="font-mono text-white font-semibold">
                {riotStatus?.perfJob?.lastRunAt
                  ? new Date(riotStatus.perfJob.lastRunAt).toLocaleTimeString()
                  : "Never"}
              </div>
            </div>
          </div>

          {riotStatus?.perfJob && (
            <div className="flex items-center gap-3 text-sm">
              {riotStatus.perfJob.running ? (
                <span className="flex items-center gap-1.5 text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> Running...
                </span>
              ) : riotStatus.perfJob.lastRunAt ? (
                <span className="text-muted-foreground">
                  Last run: {riotStatus.perfJob.lastRunProcessed} players processed
                  {riotStatus.perfJob.lastRunErrors > 0 && (
                    <span className="text-amber-400 ml-1">({riotStatus.perfJob.lastRunErrors} errors)</span>
                  )}
                </span>
              ) : null}
            </div>
          )}

          <button
            data-testid="button-perf-run"
            onClick={() => perfJobMutation.mutate()}
            disabled={perfJobMutation.isPending || riotStatus?.perfJob?.running}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit"
          >
            <Brain className={`w-4 h-4 ${perfJobMutation.isPending ? "animate-spin" : ""}`} />
            {perfJobMutation.isPending ? "Starting..." : "Run Perf Pricing Now"}
          </button>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Fetches recent ranked matches for 10 players, computes role-weighted PP scores (0–100), applies EMA smoothing (α=0.2) and a ±20% daily circuit breaker, then updates <code className="text-white/60">riot_assets.price</code> and <code className="text-white/60">momentum</code>.
          </p>
        </div>

        {/* System Health Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-500/15">
                <HeartPulse className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="font-semibold text-white">System Health</div>
                <div className="text-sm text-muted-foreground">Production status — <code className="text-white/50">GET /api/admin/system</code></div>
              </div>
            </div>
            <button
              data-testid="button-refresh-health"
              onClick={() => refetchHealth()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-muted-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          <div className="bg-white/3 rounded-xl border border-white/5 p-4 grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Players Synced</div>
              <div className="font-mono text-white font-semibold">{sysHealth?.playersSynced ?? "–"}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Matches Cached</div>
              <div className="font-mono text-white font-semibold">{sysHealth?.matchesCached ?? "–"}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Total Trades</div>
              <div className="font-mono text-white font-semibold">{sysHealth?.totalTrades ?? "–"}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white/3 rounded-lg border border-white/5 p-3 flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">Environment</div>
              <div className={`font-semibold font-mono text-xs ${sysHealth?.env === "production" ? "text-emerald-400" : "text-amber-400"}`}>
                {sysHealth?.env ?? "–"}
              </div>
            </div>
            <div className="bg-white/3 rounded-lg border border-white/5 p-3 flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">Riot API Key</div>
              <div className={`font-semibold text-xs ${sysHealth?.riotApiKeyPresent ? "text-emerald-400" : "text-red-400"}`}>
                {sysHealth == null ? "–" : sysHealth.riotApiKeyPresent ? "✓ Present" : "✗ Missing"}
              </div>
            </div>
            <div className="bg-white/3 rounded-lg border border-white/5 p-3 flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">Perf Job</div>
              <div className={`font-semibold text-xs ${sysHealth?.perfJobRunning ? "text-blue-400" : "text-muted-foreground"}`}>
                {sysHealth == null ? "–" : sysHealth.perfJobRunning ? "⟳ Running" : "Idle"}
              </div>
            </div>
            <div className="bg-white/3 rounded-lg border border-white/5 p-3 flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">Uptime</div>
              <div className="font-mono text-white/70 text-xs">
                {sysHealth?.uptime != null
                  ? `${Math.floor(sysHealth.uptime / 3600)}h ${Math.floor((sysHealth.uptime % 3600) / 60)}m`
                  : "–"}
              </div>
            </div>
          </div>

          {sysHealth?.lastPerfRun && (
            <p className="text-xs text-muted-foreground">
              Last pricing run: <span className="text-white/60">{new Date(sysHealth.lastPerfRun).toLocaleString()}</span>
            </p>
          )}
        </div>

        {/* Bot Traders Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-violet-500/15">
                <Bot className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <div className="font-semibold text-white">Bot Traders</div>
                <div className="text-sm text-muted-foreground">100 synthetic traders — trend, value, profit, random, whale</div>
              </div>
            </div>
            <div
              data-testid="text-bot-status"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                botStatus?.running
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-white/5 border-white/10 text-muted-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${botStatus?.running ? "bg-emerald-400" : "bg-gray-500"}`} />
              {botStatus?.running ? "Running" : "Stopped"}
            </div>
          </div>

          {/* Metrics row */}
          <div className="bg-white/3 rounded-xl border border-white/5 p-4 grid grid-cols-4 gap-4 text-sm">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <Users className="w-3 h-3" /> Bot Count
              </div>
              <div className="font-mono text-white font-semibold">{botStatus?.botCount ?? "–"}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <TrendingUp className="w-3 h-3" /> Trades/hr
              </div>
              <div data-testid="text-bots-trades-per-hour" className="font-mono text-white font-semibold">{botStatus?.tradesPerHour ?? "–"}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <BarChart2 className="w-3 h-3" /> Vol 24h
              </div>
              <div className="font-mono text-white font-semibold">
                {botStatus?.totalBotVolume24h != null ? `$${botStatus.totalBotVolume24h.toFixed(0)}` : "–"}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" /> Interval
              </div>
              <div className="font-mono text-white font-semibold">
                {botStatus?.intervalMs != null ? `${botStatus.intervalMs / 1000}s` : "–"}
              </div>
            </div>
          </div>

          {/* Control buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            {botStatus?.running ? (
              <button
                data-testid="button-bots-stop"
                onClick={() => stopBotsMutation.mutate()}
                disabled={stopBotsMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 text-sm font-semibold hover:bg-rose-600/30 transition-colors disabled:opacity-50"
              >
                <Pause className="w-4 h-4" />
                {stopBotsMutation.isPending ? "Stopping..." : "Stop Bots"}
              </button>
            ) : (
              <button
                data-testid="button-bots-start"
                onClick={() => startBotsMutation.mutate()}
                disabled={startBotsMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {startBotsMutation.isPending ? "Starting..." : "Start Bots"}
              </button>
            )}
            <button
              data-testid="button-bots-seed"
              onClick={() => seedBotsMutation.mutate()}
              disabled={seedBotsMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <Users className="w-4 h-4" />
              {seedBotsMutation.isPending ? "Seeding..." : "Seed 100 Bots"}
            </button>
          </div>

          {/* Config row */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted-foreground font-medium">Configuration</div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Interval (ms)</label>
                <Input
                  data-testid="input-bot-interval"
                  type="number"
                  placeholder={`${botStatus?.intervalMs ?? 10000}`}
                  value={botIntervalInput}
                  onChange={(e) => setBotIntervalInput(e.target.value)}
                  className="w-24 h-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Batch min</label>
                <Input
                  data-testid="input-bot-batch-min"
                  type="number"
                  placeholder={`${botStatus?.batchSizeMin ?? 5}`}
                  value={botBatchMinInput}
                  onChange={(e) => setBotBatchMinInput(e.target.value)}
                  className="w-16 h-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Batch max</label>
                <Input
                  data-testid="input-bot-batch"
                  type="number"
                  placeholder={`${botStatus?.batchSizeMax ?? 10}`}
                  value={botBatchMaxInput}
                  onChange={(e) => setBotBatchMaxInput(e.target.value)}
                  className="w-16 h-8 text-xs"
                />
              </div>
              <button
                data-testid="button-bots-config-save"
                onClick={() => botConfigMutation.mutate()}
                disabled={botConfigMutation.isPending || (!botIntervalInput && !botBatchMinInput && !botBatchMaxInput)}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-muted-foreground hover:bg-white/10 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {botConfigMutation.isPending ? "Saving..." : "Save Config"}
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Bots trade every {botStatus?.intervalMs ? botStatus.intervalMs / 1000 : 10}s in batches of {botStatus?.batchSizeMin ?? 5}–{botStatus?.batchSizeMax ?? 10}. Each uses <code className="text-white/50">executeRiotTrade</code> with full validation. Position size is capped at 5% of bot wallet (10% for whales). Bots are seeded with $10,000 play-money each.
          </p>
        </div>

        <div className="bg-card border border-white/10 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-3 text-sm">How the Simulator Works</h3>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Every 15 seconds, the Market Maker bot executes a random trade on a random asset from the active mode.</p>
            <p>In <strong className="text-white">REAL_RIOT_NA1</strong> mode it trades riot_assets (liquidity=25,000). In <strong className="text-white">SANDBOX</strong> mode it trades vaults (liquidity=10,000).</p>
            <p>The price impact formula is: <span className="font-mono text-white/70">new_price = current_price × (1 + qty / liquidity)</span></p>
            <p>A 2% fee is applied to each trade. The bot has an effectively unlimited balance.</p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
