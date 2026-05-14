import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "./layout";
import { Link } from "wouter";
import { Shield, ShieldOff, Eye, Users, ChevronDown, ChevronUp, Search, Key, Trash2, ShieldCheck, ShieldX, Loader2, X, AlertTriangle, UserPlus, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AdminUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  gamesSelected: string[] | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  status: string | null;
  role: string | null;
  mustChangePassword: boolean | null;
  createdByAdmin: boolean | null;
};

function StatusBadge({ status, role, mustChangePassword }: { status: string | null; role: string | null; mustChangePassword?: boolean | null }) {
  return (
    <div className="flex flex-col gap-1">
      {status === "deleted" && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/15 text-gray-400 border border-gray-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          Deleted
        </span>
      )}
      {status === "blocked" && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          Blocked
        </span>
      )}
      {status !== "deleted" && status !== "blocked" && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Active
        </span>
      )}
      {mustChangePassword && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
          <RotateCcw className="w-2.5 h-2.5" />
          Must reset pwd
        </span>
      )}
    </div>
  );
}

// ── Create User Modal ────────────────────────────────────────────────────────
function CreateUserModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [mustChange, setMustChange] = useState(true);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/users/create", {
        email, displayName, password, role, mustChangePassword: mustChange,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "User created", description: `Account created for ${email}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to create user", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0F1623] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <UserPlus className="w-4 h-4 text-primary" />
            Create User
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Email *</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" data-testid="input-create-email" className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Display Name</Label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Optional — defaults to email prefix" className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Temporary Password *</Label>
            <Input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" data-testid="input-create-password" className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="bg-black/30 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1f2e] border-white/10">
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white/70">
            <input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} className="accent-primary" />
            Force password change on first login
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-white">Cancel</Button>
          <Button
            data-testid="button-create-user-confirm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !email || !password || password.length < 6}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {mutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Creating…</> : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/15 text-violet-400 border border-violet-500/20">
        <Shield className="w-3 h-3" />
        Admin
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">User</span>;
}

// ── Change Password Modal ──────────────────────────────────────────────────────
function ChangePasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/users/${user.id}/password`, { password });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update password");
      }
    },
    onSuccess: () => {
      toast({ title: "Password updated", description: `Password for ${user.displayName || user.email} has been changed.` });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Failed to update password", description: e.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0F1623] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Key className="w-4 h-4 text-violet-400" />
            Reset Password
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm text-muted-foreground pb-1">
          <p>Setting new password for <span className="text-white font-medium">{user.displayName || user.email || user.id}</span></p>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">New Password</Label>
            <Input
              type="password"
              data-testid="input-new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="bg-black/30 border-white/10 text-white placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Confirm Password</Label>
            <Input
              type="password"
              data-testid="input-confirm-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              className="bg-black/30 border-white/10 text-white placeholder:text-muted-foreground/50"
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <X className="w-3 h-3" />{error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-white">
            Cancel
          </Button>
          <Button
            data-testid="button-confirm-password"
            onClick={handleSubmit}
            disabled={mutation.isPending || !password || !confirm}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {mutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Set Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete User Modal ──────────────────────────────────────────────────────────
function DeleteUserModal({ user, onClose, onDeleted }: { user: AdminUser; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [confirmation, setConfirmation] = useState("");
  const handle = user.displayName || user.email || user.id;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/users/${user.id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to delete user");
      }
    },
    onSuccess: () => {
      toast({ title: "User deleted", description: `${handle} has been soft-deleted and can no longer log in.` });
      onDeleted();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Failed to delete user", description: e.message, variant: "destructive" });
    },
  });

  const confirmed = confirmation === handle;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0F1623] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-4 h-4" />
            Delete User
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            This will <span className="text-white font-medium">soft-delete</span> the account. All trading history and arena data will be preserved, but the user will no longer be able to log in.
          </p>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-red-300 text-xs">
            You are deleting: <span className="font-semibold text-red-200">{handle}</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Type <span className="text-white font-mono">{handle}</span> to confirm
            </Label>
            <Input
              data-testid="input-delete-confirm"
              value={confirmation}
              onChange={e => setConfirmation(e.target.value)}
              placeholder={handle}
              className="bg-black/30 border-white/10 text-white placeholder:text-muted-foreground/30 font-mono"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-white">
            Cancel
          </Button>
          <Button
            data-testid="button-confirm-delete"
            onClick={() => mutation.mutate()}
            disabled={!confirmed || mutation.isPending}
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
          >
            {mutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Deleting…</> : "Delete User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"createdAt" | "email" | "displayName" | "status" | "role">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [passwordModalUser, setPasswordModalUser] = useState<AdminUser | null>(null);
  const [deleteModalUser, setDeleteModalUser] = useState<AdminUser | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    refetchInterval: 30000,
  });

  const blockMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/admin/users/${id}/block`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User blocked" });
    },
    onError: () => toast({ title: "Failed to block user", variant: "destructive" }),
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/admin/users/${id}/unblock`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User unblocked" });
    },
    onError: () => toast({ title: "Failed to unblock user", variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "admin" | "user" }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/role`, { role });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update role");
      }
      return { id, role };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      // Always invalidate the auth cache — if the promoted user is currently
      // browsing, their next window focus / navigation will pick up the new role.
      // If the acting admin promoted themselves, they see the menu change instantly.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

      if (result.role === "admin") {
        toast({
          title: "Admin access granted",
          description: "Role updated in the database. The user will see admin access on their next page navigation or tab focus.",
        });
      } else {
        toast({
          title: "Admin access removed",
          description: "Role updated. The user's admin access is revoked — they will lose access on their next page navigation or tab focus.",
        });
      }
    },
    onError: (e: any) => {
      toast({ title: "Role update failed", description: e.message ?? "Failed to update role", variant: "destructive" });
    },
  });

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />;
  };

  const filtered = users
    .filter(u => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (u.displayName || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.firstName || "").toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = (a[sortField] || "") as string;
      const bv = (b[sortField] || "") as string;
      return av.localeCompare(bv) * dir;
    });

  const isSelf = (userId: string) => userId === currentUser?.id;

  return (
    <AdminLayout>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, email or ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-admin-search"
              className="w-full pl-9 pr-4 py-2 bg-card border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              <span data-testid="admin-user-count">{users.length} users</span>
            </div>
            <Button
              size="sm"
              onClick={() => setShowCreateUser(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              data-testid="button-create-user"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              Create User
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                    <button onClick={() => handleSort("displayName")} className="flex items-center gap-1 hover:text-white transition-colors">
                      Name <SortIcon field="displayName" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                    <button onClick={() => handleSort("email")} className="flex items-center gap-1 hover:text-white transition-colors">
                      Email <SortIcon field="email" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                    <button onClick={() => handleSort("role")} className="flex items-center gap-1 hover:text-white transition-colors">
                      Role <SortIcon field="role" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">
                    <button onClick={() => handleSort("createdAt")} className="flex items-center gap-1 hover:text-white transition-colors">
                      Joined <SortIcon field="createdAt" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                    <button onClick={() => handleSort("status")} className="flex items-center gap-1 hover:text-white transition-colors">
                      Status <SortIcon field="status" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/5">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-white/5 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Users className="w-8 h-8 opacity-30" />
                        <span>{search ? `No users found for "${search}"` : "No users found"}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((user, i) => {
                    const isDeleted = user.status === "deleted";
                    const self = isSelf(user.id);
                    return (
                      <motion.tr
                        key={user.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.015 }}
                        className={`border-b border-white/5 transition-colors ${isDeleted ? "opacity-50" : "hover:bg-white/3"}`}
                        data-testid={`row-user-${user.id}`}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <div className="font-medium text-white flex items-center gap-1.5">
                              {user.displayName || "—"}
                              {self && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20">you</span>}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">{user.id.slice(0, 12)}…</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                          {user.email || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={user.role} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell text-xs">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={user.status} role={user.role} mustChangePassword={user.mustChangePassword} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* View */}
                            <Link href={`/admin/users/${user.id}`}>
                              <button
                                data-testid={`button-view-user-${user.id}`}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                                title="View profile"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </Link>

                            {/* Block / Unblock */}
                            {!isDeleted && (
                              user.status === "blocked" ? (
                                <button
                                  data-testid={`button-unblock-user-${user.id}`}
                                  onClick={() => unblockMutation.mutate(user.id)}
                                  disabled={unblockMutation.isPending}
                                  className="p-1.5 rounded-md text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                                  title="Unblock user"
                                >
                                  <ShieldOff className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  data-testid={`button-block-user-${user.id}`}
                                  onClick={() => blockMutation.mutate(user.id)}
                                  disabled={blockMutation.isPending || self}
                                  className="p-1.5 rounded-md text-amber-500 hover:bg-amber-500/10 transition-colors disabled:opacity-30"
                                  title={self ? "Cannot block yourself" : "Block user"}
                                >
                                  <Shield className="w-4 h-4" />
                                </button>
                              )
                            )}

                            {/* Make Admin / Remove Admin */}
                            {!isDeleted && (
                              user.role === "admin" ? (
                                <button
                                  data-testid={`button-remove-admin-${user.id}`}
                                  onClick={() => roleMutation.mutate({ id: user.id, role: "user" })}
                                  disabled={roleMutation.isPending || self}
                                  className="p-1.5 rounded-md text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-30"
                                  title={self ? "Cannot remove your own admin" : "Remove admin"}
                                >
                                  <ShieldX className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  data-testid={`button-make-admin-${user.id}`}
                                  onClick={() => roleMutation.mutate({ id: user.id, role: "admin" })}
                                  disabled={roleMutation.isPending}
                                  className="p-1.5 rounded-md text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
                                  title="Make admin"
                                >
                                  <ShieldCheck className="w-4 h-4" />
                                </button>
                              )
                            )}

                            {/* Reset Password */}
                            {!isDeleted && (
                              <button
                                data-testid={`button-reset-password-${user.id}`}
                                onClick={() => setPasswordModalUser(user)}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                                title="Reset password"
                              >
                                <Key className="w-4 h-4" />
                              </button>
                            )}

                            {/* Delete */}
                            {!isDeleted && !self && (
                              <button
                                data-testid={`button-delete-user-${user.id}`}
                                onClick={() => setDeleteModalUser(user)}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Delete user"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-1">
          <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> View profile</span>
          <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-amber-500" /> Block</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-violet-400" /> Make Admin</span>
          <span className="flex items-center gap-1.5"><ShieldX className="w-3.5 h-3.5 text-violet-400" /> Remove Admin</span>
          <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5 text-blue-400" /> Reset Password</span>
          <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 text-red-400" /> Delete (soft)</span>
        </div>
      </div>

      {/* Modals */}
      {showCreateUser && <CreateUserModal onClose={() => setShowCreateUser(false)} />}
      {passwordModalUser && (
        <ChangePasswordModal
          user={passwordModalUser}
          onClose={() => setPasswordModalUser(null)}
        />
      )}
      {deleteModalUser && (
        <DeleteUserModal
          user={deleteModalUser}
          onClose={() => setDeleteModalUser(null)}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] })}
        />
      )}
    </AdminLayout>
  );
}
