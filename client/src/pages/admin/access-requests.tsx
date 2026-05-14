import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "./layout";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, XCircle, UserPlus, Clock, Filter, Search,
  ChevronDown, Loader2, Mail, Globe, Gamepad2, AtSign, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type AccessRequest = {
  id: string;
  fullName: string;
  email: string;
  region: string | null;
  primaryGame: string | null;
  usernameInterest: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  reviewedAt: string | null;
  createdAt: string | null;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/20">Rejected</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">Pending</Badge>;
}

function CreateUserDialog({ request, onClose }: { request: AccessRequest; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/access-requests/${request.id}/create-user`, {
        password,
        mustChangePassword: forceChange,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "User created", description: `Account created for ${request.email}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/access-requests"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#1a1f2e] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Create User from Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-black/20 rounded-lg p-3 text-sm space-y-1">
            <p><span className="text-white/50">Name:</span> {request.fullName}</p>
            <p><span className="text-white/50">Email:</span> {request.email}</p>
            {request.usernameInterest && <p><span className="text-white/50">Desired handle:</span> {request.usernameInterest}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-white/70 text-sm">Temporary Password *</Label>
            <Input
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              data-testid="input-temp-password"
              className="bg-black/20 border-white/10 text-white"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white/70">
            <input type="checkbox" checked={forceChange} onChange={e => setForceChange(e.target.checked)} className="accent-primary" />
            Force password change on first login
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 hover:bg-white/5 text-white">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || password.length < 6}
            className="bg-primary hover:bg-primary/90"
            data-testid="button-create-user-confirm"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminAccessRequestsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [createUserFor, setCreateUserFor] = useState<AccessRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery<AccessRequest[]>({
    queryKey: ["/api/admin/access-requests", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/admin/access-requests?status=${statusFilter}`, { credentials: "include" });
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/access-requests/${id}/approve`);
      if (!res.ok) throw new Error("Failed to approve");
    },
    onSuccess: () => {
      toast({ title: "Request approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/access-requests"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to approve request", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/access-requests/${id}/reject`);
      if (!res.ok) throw new Error("Failed to reject");
    },
    onSuccess: () => {
      toast({ title: "Request rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/access-requests"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to reject request", variant: "destructive" }),
  });

  const filtered = requests.filter(r =>
    !search ||
    r.fullName.toLowerCase().includes(search.toLowerCase()) ||
    r.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Access Requests</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Review and approve user access applications</p>
          </div>
          <div className="flex items-center gap-2">
            {(["pending", "approved", "rejected", "all"] as const).map(s => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
                className={statusFilter === s ? "bg-primary text-primary-foreground" : "border-white/10 hover:bg-white/5 text-white capitalize"}
                data-testid={`filter-${s}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search"
            className="pl-9 bg-secondary/40 border-white/10 text-white"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? "No requests match your search." : `No ${statusFilter === "all" ? "" : statusFilter} requests.`}
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filtered.map((request, i) => (
                <motion.div
                  key={request.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-secondary/40 border border-white/8 rounded-xl p-4"
                  data-testid={`request-card-${request.id}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-white font-semibold" data-testid={`text-name-${request.id}`}>{request.fullName}</span>
                        <StatusBadge status={request.status} />
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Mail className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{request.email}</span>
                        </div>
                        {request.region && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Globe className="w-3.5 h-3.5 shrink-0" />
                            <span>{request.region.toUpperCase()}</span>
                          </div>
                        )}
                        {request.primaryGame && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="capitalize">{request.primaryGame}</span>
                          </div>
                        )}
                        {request.usernameInterest && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <AtSign className="w-3.5 h-3.5 shrink-0" />
                            <span>{request.usernameInterest}</span>
                          </div>
                        )}
                      </div>
                      {request.note && (
                        <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                          <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="italic">{request.note}</span>
                        </div>
                      )}
                      <p className="mt-2 text-xs text-white/30">
                        Submitted {request.createdAt ? new Date(request.createdAt).toLocaleDateString() : "—"}
                        {request.reviewedAt && ` · Reviewed ${new Date(request.reviewedAt).toLocaleDateString()}`}
                      </p>
                    </div>

                    {request.status === "pending" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          onClick={() => rejectMutation.mutate(request.id)}
                          disabled={rejectMutation.isPending}
                          variant="outline"
                          className="border-red-500/20 hover:bg-red-500/10 text-red-400"
                          data-testid={`button-reject-${request.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approveMutation.mutate(request.id)}
                          disabled={approveMutation.isPending}
                          className="bg-emerald-600 hover:bg-emerald-600/80 text-white"
                          data-testid={`button-approve-${request.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setCreateUserFor(request)}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground"
                          data-testid={`button-create-user-${request.id}`}
                        >
                          <UserPlus className="w-4 h-4 mr-1" />
                          Create User
                        </Button>
                      </div>
                    )}

                    {request.status === "approved" && (
                      <Button
                        size="sm"
                        onClick={() => setCreateUserFor(request)}
                        variant="outline"
                        className="border-white/10 hover:bg-white/5 text-white shrink-0"
                        data-testid={`button-create-user-${request.id}`}
                      >
                        <UserPlus className="w-4 h-4 mr-1" />
                        Create User
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {createUserFor && (
        <CreateUserDialog request={createUserFor} onClose={() => setCreateUserFor(null)} />
      )}
    </AdminLayout>
  );
}
