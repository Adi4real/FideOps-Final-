import { useState, useEffect } from "react";
import { Search, Plus, Upload, ChevronRight, Pencil, Trash2, RefreshCw } from "lucide-react";

// Firebase Imports
import { db } from "../firebase"; 
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp 
} from "firebase/firestore";

import ClientImport from "@/components/clients/ClientImport.jsx";
import ClientForm from "@/components/clients/ClientForm.jsx";
import { format, parseISO } from "date-fns";

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editClient, setEditClient] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);

  // Real-time synchronization for Clients and Tasks
  useEffect(() => {
    const clientsRef = collection(db, "clients");
    const tasksRef = collection(db, "tasks");

    // Listen for Clients
    const unsubClients = onSnapshot(query(clientsRef, orderBy("client_name")), (snap) => {
      const clientData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClients(clientData);
      setLoading(false);
    });

    // Listen for Tasks (to populate Activity Timeline)
    const unsubTasks = onSnapshot(query(tasksRef, orderBy("entry_date", "desc")), (snap) => {
      const taskData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTasks(taskData);
    });

    return () => { unsubClients(); unsubTasks(); };
  }, []);

  const filtered = search.length >= 1
    ? clients.filter(c =>
        c.client_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.client_code?.toLowerCase().includes(search.toLowerCase()) ||
        c.rm_assigned?.toLowerCase().includes(search.toLowerCase()) ||
        c.branch?.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  // Compute tasks for the selected client using client_code link
  const clientTasks = selected ? tasks.filter(t => t.client_code === selected.client_code) : [];

  const handleDelete = async (client) => {
    if (!window.confirm(`Delete "${client.client_name}" permanently?`)) return;
    try {
      await deleteDoc(doc(db, "clients", client.id));
      if (selected?.id === client.id) setSelected(null);
    } catch (error) {
      console.error("Error deleting client:", error);
    }
  };

  const handleSave = async (data) => {
    try {
      if (data.id) {
        // Update existing client
        const clientRef = doc(db, "clients", data.id);
        await updateDoc(clientRef, data);
      } else {
        // Check for duplicate client code locally (snapshot-based)
        const exists = clients.some(c => c.client_code === data.client_code);
        if (exists) { 
          alert("Client code already exists!"); 
          return; 
        }
        // Create new client
        await addDoc(collection(db, "clients"), { 
          ...data, 
          created_at: serverTimestamp() 
        });
      }
      setShowForm(false);
      setEditClient(null);
    } catch (error) {
      console.error("Error saving client:", error);
    }
  };

  // Helper function for inline task status updates
  const handleTaskStatusUpdate = async (taskId, newStatus) => {
    try {
      const taskRef = doc(db, "tasks", taskId);
      const update = { status: newStatus };
      if (newStatus === "Completed") {
        update.closure_date = format(new Date(), "yyyy-MM-dd");
      }
      await updateDoc(taskRef, update);
    } catch (error) {
      console.error("Error updating task status:", error);
    }
  };

  const openEdit = (client) => { setEditClient(client); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditClient(null); };

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh", color: "var(--text-main)" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>Client Master</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{clients.length} clients registered</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {}} className="p-2 rounded-xl transition-colors" style={{ background: "var(--glass)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowImport(v => !v)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all" style={{ background: "var(--glass)", border: "1px solid var(--brand-green)", color: "var(--brand-green)" }}>
            <Upload className="w-4 h-4" /> Import Excel
          </button>
          <button onClick={() => { setEditClient(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90" style={{ background: "var(--brand-green)", color: "white" }}>
            <Plus className="w-4 h-4" /> Add Client
          </button>
        </div>
      </div>

      {showImport && (
        <ClientImport onImportDone={() => setShowImport(false)} onClose={() => setShowImport(false)} />
      )}
      {showForm && (
        <ClientForm client={editClient} onSave={handleSave} onClose={closeForm} />
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Client List */}
        <div className="lg:col-span-1 rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
          <div className="p-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
              <input
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-main)" }}
                placeholder="Search clients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1" style={{ maxHeight: "600px" }}>
            {loading ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No clients found</div>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: selected?.id === c.id ? "rgba(0, 130, 84, 0.12)" : "transparent",
                  }}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm"
                    style={{ background: selected?.id === c.id ? "var(--brand-green)" : "rgba(255,255,255,0.07)", color: selected?.id === c.id ? "white" : "var(--brand-green)" }}>
                    {c.client_name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{c.client_name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{c.client_code} · {c.branch}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Client Detail */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="rounded-2xl flex items-center justify-center min-h-[400px]" style={{ background: "var(--glass)", border: "1px solid var(--border)" }}>
              <div className="text-center">
                <Search className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: "var(--text-muted)" }} />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Select a client to view details</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Client Info Card */}
              <div className="rounded-2xl p-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white"
                      style={{ background: "var(--brand-green)" }}>
                      {selected.client_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold" style={{ color: "var(--text-main)" }}>{selected.client_name}</h2>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>{selected.client_code} · {selected.branch}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => openEdit(selected)} className="text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all"
                      style={{ color: "var(--brand-green)", background: "rgba(0,130,84,0.1)", border: "1px solid rgba(0,130,84,0.3)" }}>
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => handleDelete(selected)} className="text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all"
                      style={{ color: "#f87171", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)" }}>
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  {[["RM Assigned", selected.rm_assigned], ["Branch", selected.branch]].map(([k, v]) => v && (
                    <div key={k}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>{k}</p>
                      <p className="font-medium" style={{ color: "var(--text-main)" }}>{v}</p>
                    </div>
                  ))}
                </div>
                {selected.notes && (
                  <div className="mt-4 p-3 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    {selected.notes}
                  </div>
                )}
              </div>

              {/* Activity Timeline */}
              <div className="rounded-2xl p-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
                <h3 className="font-semibold mb-4" style={{ color: "var(--text-main)" }}>Activity Timeline ({clientTasks.length} tasks)</h3>
                {clientTasks.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>No tasks for this client yet.</p>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {clientTasks.map(t => {
                      const statusColors = {
                        "Pending":        { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24", border: "rgba(251,191,36,0.25)" },
                        "Under Process":  { bg: "rgba(96,165,250,0.12)",  text: "#60a5fa", border: "rgba(96,165,250,0.25)" },
                        "Waiting Client": { bg: "rgba(167,139,250,0.12)", text: "#a78bfa", border: "rgba(167,139,250,0.25)" },
                        "Completed":      { bg: "rgba(74,222,128,0.12)",  text: "#4ade80", border: "rgba(74,222,128,0.25)" },
                        "Cancelled":      { bg: "rgba(100,116,139,0.12)", text: "#64748b", border: "rgba(100,116,139,0.2)" },
                      };
                      const sc = statusColors[t.status] || statusColors["Pending"];
                      return (
                        <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl"
                          style={{ border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
                          <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: sc.text }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold" style={{ color: "var(--brand-green)" }}>{t.task_id}</span>
                              <span className="text-xs font-medium" style={{ color: "var(--text-main)" }}>{t.action}</span>
                              <select
                                value={t.status}
                                onChange={(e) => handleTaskStatusUpdate(t.id, e.target.value)}
                                style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, cursor: "pointer" }}
                              >
                                {["Pending","Under Process","Waiting Client","Completed","Cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                              {t.entry_date && format(parseISO(t.entry_date), "dd MMM yyyy")} · {t.assigned_to}
                              {t.closure_date && ` · Closed: ${format(parseISO(t.closure_date), "dd MMM yyyy")}`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}