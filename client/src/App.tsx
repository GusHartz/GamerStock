import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { AppErrorBoundary, ErrorBoundary } from "@/components/error-boundary";

import { isPredictEnabled } from "@/lib/featureFlags";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import TerminalPage from "@/pages/terminal";
import VaultDetailPage from "@/pages/vault-detail";
import PlayerPage from "@/pages/player";
import PlayerOperatorPage from "@/pages/player-operator";
import PlayerHubPage from "@/pages/player-hub";
import PortfolioPage from "@/pages/portfolio";
import LeaderboardPage from "@/pages/leaderboard";
import WatchlistPage from "@/pages/watchlist";
import RequestAccessPage from "@/pages/request-access";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import ForcePasswordChangePage from "@/pages/force-password-change";
import SecuritySettingsPage from "@/pages/settings/security";
import SteamCallbackPage from "@/pages/steam-callback";
import ArenaPage from "@/pages/arena";
import ArenaLeaderboardsPage from "@/pages/arena-leaderboards";
import ArenaAchievementsPage from "@/pages/arena-achievements";
import ArenaSeasonsPage from "@/pages/arena-seasons";
import ArenaTraderProfilePage from "@/pages/arena-trader-profile";
import ArenaDraftPage from "@/pages/arena-draft";
import AdminUsersPage from "@/pages/admin/users";
import AdminUserDetailPage from "@/pages/admin/user-detail";
import AdminMetricsPage from "@/pages/admin/metrics";
import AdminMarketPage from "@/pages/admin/market";
import AdminArenaPage from "@/pages/admin/arena";
import AdminAmmPage from "@/pages/admin/amm";
import AdminMarketLabPage from "@/pages/admin/market-lab";
import AdminDraftPage from "@/pages/admin/draft";
import AdminAccessRequestsPage from "@/pages/admin/access-requests";
import AdminRevenueDashboardPage from "@/pages/admin/revenue-dashboard";
import AdminPlayerEarningsPage from "@/pages/admin/player-earnings";
import PlayerPublicPage from "@/pages/player-public";
import AdminPredictDashboard from "@/pages/admin/predict-dashboard";
import AdminIngestionPage from "@/pages/admin/ingestion";
import AdminCandidateDetailPage from "@/pages/admin/ingestion-candidate";
import AdminEventsPage from "@/pages/admin/events";
import AdminEventDetailPage from "@/pages/admin/event-detail";
import AdminHistoryPage from "@/pages/admin/history";
import AdminHistoryEventPage from "@/pages/admin/history-event";
import AdminDisplayQueuePage from "@/pages/admin/display-queue";
import AdminMediaPage from "@/pages/admin/media";
import AdminMultigameClaimsPage from "@/pages/admin/multigame-claims";
import AdminMultigameAssetsReviewPage from "@/pages/admin/multigame-assets-review";
import AdminMultigameOpsPage from "@/pages/admin/multigame-ops";
import AssetsPage from "@/pages/assets";
import AssetDetailPage from "@/pages/asset-detail";
import PredictionsPage from "@/pages/predictions";
import PredictionsMarketPage from "@/pages/predictions-market";
import { Redirect } from "wouter";
import { TradeCardProvider } from "@/features/trade/TradeCardContext";
import GlobalTradePanel from "@/features/trade/GlobalTradePanel";
import { TerminalProvider } from "@/state/TerminalProvider";
import { TerminalTradeModal } from "@/components/terminal/TerminalTradeModal";

const AuthSpinner = () => (
  <div className="min-h-screen bg-[#0A0E17] flex flex-col items-center justify-center gap-3">
    <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    <p className="text-xs text-muted-foreground font-mono animate-pulse">Verifying session…</p>
  </div>
);

function ProtectedRoute({ component: Component, label, noPadding }: { component: React.ComponentType; label?: string; noPadding?: boolean }) {
  const { user, isAuthenticated, isInitialLoading } = useAuth();

  if (isInitialLoading) {
    return <AuthSpinner />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (user?.mustChangePassword) {
    return <ForcePasswordChangePage />;
  }

  return (
    <Layout noPadding={noPadding}>
      <ErrorBoundary label={label ?? "Page"}>
        <Component />
      </ErrorBoundary>
    </Layout>
  );
}

function AdminRoute({ component: Component, label }: { component: React.ComponentType; label?: string }) {
  const { user, isInitialLoading } = useAuth();

  if (isInitialLoading) {
    return <AuthSpinner />;
  }

  if (!user) return <Redirect to="/login" />;
  if (user.role !== "admin") return <Redirect to="/terminal" />;

  return (
    <Layout>
      <ErrorBoundary label={label ?? "Admin page"}>
        <Component />
      </ErrorBoundary>
    </Layout>
  );
}

// Route guard for all Predict surfaces (user-facing and admin).
// When isPredictEnabled() is false, redirects silently to /terminal regardless of
// authentication state. When enabled, behaves like ProtectedRoute (or AdminRoute
// when admin=true). Import/page code is never removed — just conditionally rendered.
function PredictRoute({ component: Component, label, admin = false }: { component: React.ComponentType; label?: string; admin?: boolean }) {
  const { user, isAuthenticated, isInitialLoading } = useAuth();

  if (!isPredictEnabled()) return <Redirect to="/terminal" />;

  if (isInitialLoading) return <AuthSpinner />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (admin && user?.role !== "admin") return <Redirect to="/terminal" />;
  if (!admin && user?.mustChangePassword) return <ForcePasswordChangePage />;

  return (
    <Layout>
      <ErrorBoundary label={label ?? "Page"}>
        <Component />
      </ErrorBoundary>
    </Layout>
  );
}

function RootRoute() {
  const { user, isAuthenticated, isInitialLoading } = useAuth();
  if (isInitialLoading) return <AuthSpinner />;
  if (isAuthenticated) {
    if (user?.mustChangePassword) return <ForcePasswordChangePage />;
    return <Redirect to="/terminal" />;
  }
  return <Redirect to="/login" />;
}

function Router() {
  const { isAuthenticated } = useAuth();

  return (
    <Switch>
      <Route path="/login">
        {isAuthenticated ? <Redirect to="/terminal" /> : <LoginPage />}
      </Route>

      <Route path="/signup">
        {isAuthenticated ? <Redirect to="/terminal" /> : <SignupPage />}
      </Route>

      <Route path="/">
        {() => <RootRoute />}
      </Route>

      <Route path="/home">
        {() => <Redirect to="/terminal" />}
      </Route>

      <Route path="/predictions">
        {() => <PredictRoute component={PredictionsPage} label="Predictions" />}
      </Route>

      <Route path="/predictions/markets/:idOrSlug">
        {() => <PredictRoute component={PredictionsMarketPage} label="Market Detail" />}
      </Route>

      <Route path="/vault/:id">
        {() => <ProtectedRoute component={VaultDetailPage} label="Vault" />}
      </Route>

      <Route path="/portfolio">
        {() => <ProtectedRoute component={PortfolioPage} label="Portfolio" />}
      </Route>

      <Route path="/leaderboard">
        {() => <ProtectedRoute component={LeaderboardPage} label="Leaderboard" />}
      </Route>

      <Route path="/assets">
        {() => <ProtectedRoute component={AssetsPage} label="Assets" />}
      </Route>

      <Route path="/asset/:assetId">
        {() => <ProtectedRoute component={AssetDetailPage} label="Asset Detail" />}
      </Route>

      <Route path="/terminal">
        {() => <ProtectedRoute component={TerminalPage} label="Terminal" noPadding />}
      </Route>

      <Route path="/player/:id">
        {() => <ProtectedRoute component={PlayerPage} label="Player" />}
      </Route>

      <Route path="/player-hub">
        {() => <ProtectedRoute component={PlayerHubPage} label="Player Hub" />}
      </Route>

      <Route path="/player-operator/:assetId">
        {() => <ProtectedRoute component={PlayerOperatorPage} label="Operator Mode" />}
      </Route>

      <Route path="/players/:assetId">
        {() => <PlayerPublicPage />}
      </Route>

      <Route path="/watchlist">
        {() => <ProtectedRoute component={WatchlistPage} label="Watchlist" />}
      </Route>

      <Route path="/arena/profile">
        {() => <ProtectedRoute component={ArenaPage} label="Arena Profile" />}
      </Route>

      <Route path="/arena/leaderboards">
        {() => <ProtectedRoute component={ArenaLeaderboardsPage} label="Arena Leaderboards" />}
      </Route>

      <Route path="/arena/achievements">
        {() => <ProtectedRoute component={ArenaAchievementsPage} label="Arena Achievements" />}
      </Route>

      <Route path="/arena/seasons">
        {() => <ProtectedRoute component={ArenaSeasonsPage} label="Arena Seasons" />}
      </Route>

      <Route path="/arena/draft">
        {() => <ProtectedRoute component={ArenaDraftPage} label="Weekly Draft" />}
      </Route>

      <Route path="/arena/trader/:username">
        {() => <ProtectedRoute component={ArenaTraderProfilePage} label="Trader Profile" />}
      </Route>

      <Route path="/admin">
        {() => <Redirect to="/admin/users" />}
      </Route>

      <Route path="/admin/users/:id">
        {() => <AdminRoute component={AdminUserDetailPage} label="User Detail" />}
      </Route>

      <Route path="/admin/users">
        {() => <AdminRoute component={AdminUsersPage} label="Users" />}
      </Route>

      <Route path="/admin/metrics">
        {() => <AdminRoute component={AdminMetricsPage} label="Metrics" />}
      </Route>

      <Route path="/admin/market">
        {() => <AdminRoute component={AdminMarketPage} label="Market" />}
      </Route>

      <Route path="/admin/arena">
        {() => <AdminRoute component={AdminArenaPage} label="Arena Admin" />}
      </Route>

      <Route path="/admin/amm">
        {() => <AdminRoute component={AdminAmmPage} label="AMM Admin" />}
      </Route>

      <Route path="/admin/market-lab">
        {() => <AdminRoute component={AdminMarketLabPage} label="Market Lab" />}
      </Route>

      <Route path="/admin/draft">
        {() => <AdminRoute component={AdminDraftPage} label="Draft Admin" />}
      </Route>

      <Route path="/request-access" component={RequestAccessPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />

      <Route path="/settings/security">
        {() => <ProtectedRoute component={SecuritySettingsPage} label="Security" />}
      </Route>
      <Route path="/settings/accounts">
        {() => <Redirect to="/player-hub" />}
      </Route>
      <Route path="/settings/player-identity">
        {() => <Redirect to="/settings/security" />}
      </Route>
      <Route path="/settings/my-assets">
        {() => <Redirect to="/player-hub" />}
      </Route>

      <Route path="/admin/access-requests">
        {() => <AdminRoute component={AdminAccessRequestsPage} label="Access Requests" />}
      </Route>

      <Route path="/admin/revenue">
        {() => <AdminRoute component={AdminRevenueDashboardPage} label="Revenue Dashboard" />}
      </Route>

      <Route path="/admin/player-earnings">
        {() => <AdminRoute component={AdminPlayerEarningsPage} label="Player Earnings" />}
      </Route>

      {/* Predict admin */}
      <Route path="/admin/predict">
        {() => <PredictRoute component={AdminPredictDashboard} label="Predict Overview" admin />}
      </Route>
      <Route path="/admin/ingestion/:candidateId">
        {() => <AdminRoute component={AdminCandidateDetailPage} label="Candidate Detail" />}
      </Route>
      <Route path="/admin/ingestion">
        {() => <AdminRoute component={AdminIngestionPage} label="Ingestion Queue" />}
      </Route>
      <Route path="/admin/events/:eventId">
        {() => <AdminRoute component={AdminEventDetailPage} label="Event Detail" />}
      </Route>
      <Route path="/admin/events">
        {() => <AdminRoute component={AdminEventsPage} label="Events" />}
      </Route>
      <Route path="/admin/history/:eventId">
        {() => <AdminRoute component={AdminHistoryEventPage} label="History Event" />}
      </Route>
      <Route path="/admin/history">
        {() => <AdminRoute component={AdminHistoryPage} label="History" />}
      </Route>
      <Route path="/admin/display-queue">
        {() => <AdminRoute component={AdminDisplayQueuePage} label="Display Queue" />}
      </Route>
      <Route path="/admin/media">
        {() => <AdminRoute component={AdminMediaPage} label="Media Library" />}
      </Route>

      {/* Multigame Admin */}
      <Route path="/admin/multigame">
        {() => <Redirect to="/admin/multigame/ops" />}
      </Route>
      <Route path="/admin/multigame/ops">
        {() => <AdminRoute component={AdminMultigameOpsPage} label="Ops Summary" />}
      </Route>
      <Route path="/admin/multigame/claims">
        {() => <AdminRoute component={AdminMultigameClaimsPage} label="Multigame Claims" />}
      </Route>
      <Route path="/admin/multigame/assets-under-review">
        {() => <AdminRoute component={AdminMultigameAssetsReviewPage} label="Assets Under Review" />}
      </Route>

      <Route path="/steam-callback">
        {() => <SteamCallbackPage />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TerminalProvider>
          <TradeCardProvider>
            <TooltipProvider>
              <Router />
              <Toaster />
              <GlobalTradePanel />
              <TerminalTradeModal />
            </TooltipProvider>
          </TradeCardProvider>
        </TerminalProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
