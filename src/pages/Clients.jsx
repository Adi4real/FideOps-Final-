import { useState, useEffect } from "react";
import { Search, Plus, Upload, ChevronRight, Pencil, Trash2, RefreshCw, Wallet, Calendar, ChevronDown, ChevronUp, Filter, XCircle, CheckSquare, Check, ListTodo } from "lucide-react";

import { db } from "../firebase"; 
import { collection, query, onSnapshot, orderBy, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, where, getDocs } from "firebase/firestore";

import ClientImport from "@/components/clients/ClientImport.jsx";
import ClientForm from "@/components/clients/ClientForm.jsx";
import { format, parseISO } from "date-fns";

// --- HELPER: Calculate Total SIP Amount ---
const getSIPTotal = (investments) => {
  return (investments || []).reduce((sum, inv) => {
    const amt = parseFloat(String(inv.installment_amount).replace(/,/g, ''));
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);
};

// --- Helper: Parse the structured text string to find cancelled items ---
function parseTransactionItems(rawString) {
  if (!rawString) return [{ productName: "", amount: "", type: "SIP" }];
  
  const lines = rawString.split("\n");
  const parsed = lines.map(line => {
    const match = line.match(/^(.*?)(?:\s*\(₹([\d.,]+)\))?(?:\s*\[(.*?)\])?$/);
    if (match) {
      return { 
        productName: match[1]?.trim() || "", 
        amount: match[2]?.replace(/,/g, '')?.trim() || "",
        type: match[3]?.trim() || "SIP"
      };
    }
    return { productName: line.trim(), amount: "", type: "SIP" };
  }).filter(i => i.productName !== "");
  
  return parsed.length > 0 ? parsed : [{ productName: "", amount: "", type: "SIP" }];
}


export default function Clients() {
  const [clients, setClients] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editClient, setEditClient] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [expandedInv, setExpandedInv] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null);

  // Tab State
  const [activeTab, setActiveTab] = useState("timeline"); // "timeline" or "portfolio"
  const [taskFilter, setTaskFilter] = useState("All");

  // Filter States
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ rm: "", tax: "", holding: "" });

  // Bulk Delete States
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => {
    const clientsRef = collection(db, "clients");
    const tasksRef = collection(db, "tasks");

    const unsubClients = onSnapshot(query(clientsRef, orderBy("client_name")), (snap) => {
      const clientData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClients(clientData);
      setLoading(false);
      
      setSelected(prev => {
        if (!prev) return null;
        const updatedSelected = clientData.find(c => c.id === prev.id);
        return updatedSelected || prev;
      });
    });

    const unsubTasks = onSnapshot(query(tasksRef, orderBy("entry_date", "desc")), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubClients(); unsubTasks(); };
  }, []);

  const uniqueRMs = [...new Set(clients.map(c => c.rm_assigned).filter(v => v && v !== "-"))].sort();
  const uniqueHoldings = [...new Set(clients.map(c => c.holding_nature).filter(v => v && v !== "-"))].sort();
  const uniqueTaxes = [...new Set(clients.flatMap(c => (c.tax_status || "").split(", ")).filter(v => v && v !== "-"))].sort();

  const filtered = clients.filter(c => {
    const matchesSearch = search.length < 1 || 
      c.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.client_code?.toLowerCase().includes(search.toLowerCase()) ||
      c.rm_assigned?.toLowerCase().includes(search.toLowerCase());

    const matchesRM = filters.rm === "" || c.rm_assigned === filters.rm;
    const matchesHolding = filters.holding === "" || c.holding_nature === filters.holding;
    const matchesTax = filters.tax === "" || (c.tax_status && c.tax_status.includes(filters.tax));

    return matchesSearch && matchesRM && matchesHolding && matchesTax;
  });

  const groupedClients = Object.values(filtered.reduce((acc, c) => {
    const key = c.client_name?.trim().toLowerCase() || "unknown";
    if (!acc[key]) acc[key] = { client_name: c.client_name || "Unknown", profiles: [] };
    acc[key].profiles.push(c);
    return acc;
  }, {})).sort((a, b) => a.client_name.localeCompare(b.client_name));

  const activeFilterCount = Object.values(filters).filter(v => v !== "").length;
  
  // Client Tasks & Filtering
  const clientTasksRaw = selected ? tasks.filter(t => t.client_code === selected.client_code) : [];
  const clientTasks = clientTasksRaw.filter(t => taskFilter === "All" || t.status === taskFilter);

  const toggleBulkMode = () => {
    setIsBulkMode(!isBulkMode);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const isAllSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const toggleSelectAll = () => {
    if (isAllSelected) setSelectedIds(new Set()); 
    else setSelectedIds(new Set(filtered.map(c => c.id))); 
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete ${selectedIds.size} selected clients?`)) return;

    try {
      for (const id of selectedIds) {
        await deleteDoc(doc(db, "clients", id));
      }
      setSelectedIds(new Set());
      setIsBulkMode(false);
      if (selected && selectedIds.has(selected.id)) setSelected(null);
    } catch (error) {
      console.error("Error deleting clients:", error);
    }
  };

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
        await updateDoc(doc(db, "clients", data.id), data);
      } else {
        const tax = data.tax_status || "-";
        const exists = clients.some(c => c.client_code === data.client_code && (c.tax_status || "-") === tax);
        if (exists) { 
          alert("A client profile with this Code and Tax Status already exists!"); 
          return; 
        }
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

  const handleTaskStatusUpdate = async (taskId, newStatus, fullTaskData) => {
    try {
      const taskRef = doc(db, "tasks", taskId);
      const update = { status: newStatus };
      if (newStatus === "Completed") {
        update.closure_date = format(new Date(), "yyyy-MM-dd");
      }
      
      await updateDoc(taskRef, update);

      if (newStatus === "Completed" && fullTaskData && fullTaskData.action === "SIP Cancellation" && fullTaskData.client_code) {
        console.log(`Processing SIP Cancellation for ${fullTaskData.client_code}...`);
        
        const cancelledSchemes = parseTransactionItems(fullTaskData.product_name).map(i => i.productName.toLowerCase().trim());
        if (cancelledSchemes.length === 0) return;

        const clientsRef = collection(db, "clients");
        const q = query(clientsRef, where("client_code", "==", fullTaskData.client_code));
        const clientSnapshot = await getDocs(q);
        
        if (!clientSnapshot.empty) {
          const clientDoc = clientSnapshot.docs[0];
          const clientData = clientDoc.data();
          
          const targetKey = Object.keys(clientData).find(k => k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('investments') || k.toLowerCase().includes('sips'));
          
          if (targetKey && Array.isArray(clientData[targetKey])) {
            const originalPortfolio = clientData[targetKey];
            
            const updatedPortfolio = originalPortfolio.filter(inv => {
              const invName = (inv.scheme_name || inv.scheme || inv.productName || inv.name || "").toLowerCase().trim();
              const isCancelled = cancelledSchemes.some(cancelledName => invName.includes(cancelledName) || cancelledName.includes(invName));
              return !isCancelled;
            });

            if (originalPortfolio.length !== updatedPortfolio.length) {
              await updateDoc(doc(db, "clients", clientDoc.id), {
                [targetKey]: updatedPortfolio
              });
              console.log(`Successfully removed cancelled SIPs from Client Master: ${fullTaskData.client_code}`);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error updating task status or client master:", error);
    }
  };

  const openEdit = (client) => { setEditClient(client); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditClient(null); };

  const groupedInvestments = (selected?.investments || []).reduce((acc, inv) => {
    const folio = inv.folio_number && inv.folio_number !== "-" ? inv.folio_number : "Unassigned Folios";
    if (!acc[folio]) acc[folio] = [];
    acc[folio].push(inv);
    return acc;
  }, {});

  const renderProfileButton = (c, isSubItem) => {
    const isSelectedForDeletion = selectedIds.has(c.id);
    const isActive = !isBulkMode && selected?.id === c.id;

    return (
      <button
        key={c.id}
        onClick={() => { 
          if (isBulkMode) toggleSelection(c.id);
          else { setSelected(c); setExpandedInv(null); }
        }}
        className={`w-full text-left py-3 flex items-center gap-3 transition-colors ${isSelectedForDeletion ? 'bg-red-500/10' : ''} ${isSubItem ? 'pl-10 pr-4 border-l-2 border-brand-green/40 hover:bg-white/5' : 'px-4 hover:bg-white/5 border-b border-[var(--border)]'}`}
        style={{ background: isActive ? "rgba(0, 130, 84, 0.12)" : isSelectedForDeletion ? "rgba(248, 113, 113, 0.1)" : "transparent" }}
      >
        {isBulkMode && (
          <div className={`w-5 h-5 rounded border flex flex-shrink-0 items-center justify-center transition-all ${isSelectedForDeletion ? 'bg-red-500 border-red-500' : 'border-white/20 bg-black/20'}`}>
            {isSelectedForDeletion && <Check className="w-3 h-3 text-white" />}
          </div>
        )}

        {!isBulkMode && !isSubItem && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm"
            style={{ background: isActive ? "var(--brand-green)" : "rgba(255,255,255,0.07)", color: isActive ? "white" : "var(--brand-green)" }}>
            {c.client_name?.[0]?.toUpperCase() || "?"}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: isSelectedForDeletion ? "#f87171" : "var(--text-main)" }}>
            {isSubItem ? (c.tax_status && c.tax_status !== "-" ? c.tax_status : "Standard Profile") : c.client_name}
            {!isBulkMode && !isSubItem && c.tax_status && c.tax_status !== "-" ? <span className="text-[10px] text-brand-green ml-2">({c.tax_status})</span> : ""}
          </p>
          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
            {c.client_code} · {c.branch} {!isBulkMode && c.investments?.length ? `(${c.investments.length} SIPs)` : ""}
          </p>
        </div>
        {!isBulkMode && <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />}
      </button>
    );
  };

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh", color: "var(--text-main)" }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>Client Master</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{clients.length} profiles / {groupedClients.length} unique names</p>
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

      {showImport && <ClientImport onImportDone={() => setShowImport(false)} onClose={() => setShowImport(false)} />}
      {showForm && <ClientForm client={editClient} onSave={handleSave} onClose={closeForm} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: Client List (FIXED SCROLL) */}
        <div className="lg:col-span-1 rounded-2xl flex flex-col sticky top-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)", height: "calc(100vh - 120px)" }}>
          <div className="p-4 flex-shrink-0 z-20 bg-[#0a1612] rounded-t-2xl" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex gap-2 relative">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
                <input
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-main)" }}
                  placeholder="Search name or code..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className="relative px-3 rounded-xl border flex items-center justify-center transition-all hover:bg-white/5"
                style={{ 
                  background: activeFilterCount > 0 ? "rgba(0,130,84,0.15)" : "var(--input-bg)", 
                  borderColor: activeFilterCount > 0 ? "var(--brand-green)" : "var(--border)",
                  color: activeFilterCount > 0 ? "var(--brand-green)" : "var(--text-muted)"
                }}
              >
                <Filter className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand-green text-white flex items-center justify-center text-[9px] font-bold shadow-sm">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <button 
                onClick={toggleBulkMode}
                className="relative px-3 rounded-xl border flex items-center justify-center transition-all hover:bg-white/5"
                style={{ 
                  background: isBulkMode ? "rgba(248,113,113,0.15)" : "var(--input-bg)", 
                  borderColor: isBulkMode ? "#f87171" : "var(--border)",
                  color: isBulkMode ? "#f87171" : "var(--text-muted)"
                }}
                title="Select multiple clients to delete"
              >
                <CheckSquare className="w-4 h-4" />
              </button>

              {showFilters && (
                <div className="absolute top-[115%] right-0 w-64 p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-top-2" style={{ background: "#0a1612", borderColor: "var(--border)", zIndex: 100 }}>
                  <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-white">Filters</p>
                    {activeFilterCount > 0 && (
                      <button onClick={() => setFilters({rm: "", tax: "", holding: ""})} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold">
                        <XCircle className="w-3 h-3" /> Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">RM Assigned</label>
                      <select value={filters.rm} onChange={e => setFilters({...filters, rm: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="">All RMs</option>
                        {uniqueRMs.map(rm => <option key={rm} value={rm}>{rm}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">Tax Status</label>
                      <select value={filters.tax} onChange={e => setFilters({...filters, tax: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="">All Statuses</option>
                        {uniqueTaxes.map(tax => <option key={tax} value={tax}>{tax}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">Holding Nature</label>
                      <select value={filters.holding} onChange={e => setFilters({...filters, holding: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="">All Holdings</option>
                        {uniqueHoldings.map(hn => <option key={hn} value={hn}>{hn}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isBulkMode && (
              <div className="mt-3 p-2.5 rounded-xl border border-red-500/30 bg-red-500/10 flex items-center justify-between animate-in fade-in zoom-in-95">
                <div className="flex items-center gap-2 pl-1">
                   <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300">
                     <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isAllSelected ? 'bg-red-500 border-red-500' : 'border-red-400/50 bg-black/20'}`}>
                        {isAllSelected && <Check className="w-3 h-3 text-white" />}
                     </div>
                     {isAllSelected ? "Deselect All" : "Select All"}
                   </button>
                   <span className="text-xs font-bold text-red-400 ml-2 border-l border-red-500/30 pl-3">{selectedIds.size} Selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={toggleBulkMode} className="text-xs font-semibold text-white/50 hover:text-white px-2 py-1 transition-colors">Cancel</button>
                  <button 
                    onClick={handleBulkDelete} 
                    disabled={selectedIds.size === 0} 
                    className="flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-all"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Scrollable list container */}
          <div className="overflow-y-auto flex-1 z-10 custom-scrollbar">
            {loading ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No clients match the criteria</div>
            ) : (
              groupedClients.map(group => {
                const isMultiple = group.profiles.length > 1;
                const groupKey = group.client_name?.toLowerCase() || "unknown";
                const isExpanded = expandedGroup === groupKey;
                
                if (isMultiple) {
                  const groupTotalSIP = group.profiles.reduce((sum, p) => sum + getSIPTotal(p.investments), 0);
                  return (
                    <div key={groupKey} className="border-b border-[var(--border)]">
                      <button 
                        onClick={() => setExpandedGroup(isExpanded ? null : groupKey)} 
                        className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-white/5"
                      >
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm bg-white/5 text-white/50">
                          {group.client_name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p title={group.client_name} className="text-sm font-semibold text-white truncate">{group.client_name}</p>
                          <p className="text-[10px] text-brand-green mt-0.5 font-bold uppercase tracking-wider">
                            {group.profiles.length} Profiles {groupTotalSIP > 0 ? `· ₹${groupTotalSIP.toLocaleString('en-IN')} SIP` : ""}
                          </p>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                      </button>
                      
                      {isExpanded && (
                        <div className="bg-black/40 pb-2 shadow-inner">
                          {group.profiles.map(c => renderProfileButton(c, true))}
                        </div>
                      )}
                    </div>
                  );
                } else {
                  return renderProfileButton(group.profiles[0], false);
                }
              })
            )}
          </div>
        </div>

        {/* Right: Client Detail */}
        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <div className="rounded-2xl flex items-center justify-center min-h-[400px]" style={{ background: "var(--glass)", border: "1px solid var(--border)" }}>
              <div className="text-center">
                <Search className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: "var(--text-muted)" }} />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Select a client to view details</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header Info Card */}
              <div className="rounded-2xl p-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white"
                      style={{ background: "var(--brand-green)" }}>
                      {selected.client_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold" style={{ color: "var(--text-main)" }}>
                        {selected.client_name} <span className="text-sm text-brand-green font-mono ml-2">{selected.tax_status && selected.tax_status !== "-" ? `(${selected.tax_status})` : ""}</span>
                      </h2>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>{selected.client_code}</p>
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm border-t border-white/5 pt-4">
                  {[
                    ["Holding Nature", selected.holding_nature], 
                    ["RM Assigned", selected.rm_assigned], 
                    ["Branch", selected.branch]
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>{k}</p>
                      <p className="font-medium" style={{ color: "var(--text-main)" }}>{v && v !== "-" ? v : "—"}</p>
                    </div>
                  ))}
                </div>
                {selected.notes && selected.notes !== "-" && (
                  <div className="mt-4 p-3 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <span className="font-bold uppercase text-[10px] mr-2">Notes:</span> {selected.notes}
                  </div>
                )}
              </div>

              {/* TABS CONTAINER */}
              <div className="rounded-2xl p-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)", minHeight: "400px" }}>
                
                {/* Tab Navigation */}
                <div className="flex gap-6 border-b border-white/10 mb-6">
                  <button 
                    onClick={() => setActiveTab('timeline')} 
                    className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'timeline' ? 'text-brand-green border-b-2 border-brand-green' : 'text-[#889995] hover:text-white'}`}
                  >
                    <ListTodo className="w-4 h-4" />
                    Activity Timeline ({clientTasksRaw.length})
                  </button>
                  <button 
                    onClick={() => setActiveTab('portfolio')} 
                    className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'portfolio' ? 'text-brand-green border-b-2 border-brand-green' : 'text-[#889995] hover:text-white'}`}
                  >
                    <Wallet className="w-4 h-4" />
                    Investment Portfolio ({selected.investments?.length || 0})
                  </button>
                </div>

                {/* TAB 1: ACTIVITY TIMELINE */}
                {activeTab === "timeline" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="flex justify-end mb-4">
                      <select 
                        value={taskFilter} 
                        onChange={(e) => setTaskFilter(e.target.value)}
                        className="bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none"
                      >
                        <option value="All">All Tasks</option>
                        {["Pending","Under Process","Waiting Client","Completed","Cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {clientTasks.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995]">No tasks found matching this filter.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                        {clientTasks.map(t => {
                          const isCompleted = t.status === "Completed";
                          const statusColors = {
                            "Pending":        { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24", border: "rgba(251,191,36,0.25)" },
                            "Under Process":  { bg: "rgba(96,165,250,0.12)",  text: "#60a5fa", border: "rgba(96,165,250,0.25)" },
                            "Waiting Client": { bg: "rgba(167,139,250,0.12)", text: "#a78bfa", border: "rgba(167,139,250,0.25)" },
                            "Completed":      { bg: "rgba(74,222,128,0.15)",  text: "#4ade80", border: "rgba(74,222,128,0.4)" },
                            "Cancelled":      { bg: "rgba(100,116,139,0.12)", text: "#64748b", border: "rgba(100,116,139,0.2)" },
                          };
                          const sc = statusColors[t.status] || statusColors["Pending"];

                          return (
                            <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl transition-all"
                              style={{ 
                                border: isCompleted ? `1px solid ${sc.border}` : "1px solid var(--border)", 
                                background: isCompleted ? sc.bg : "rgba(255,255,255,0.02)" 
                              }}>
                              <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: sc.text }} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs font-bold" style={{ color: isCompleted ? "#4ade80" : "var(--brand-green)" }}>{t.task_id}</span>
                                  <span className="text-xs font-medium" style={{ color: "var(--text-main)" }}>{t.action}</span>
                                  
                                  <select
                                    value={t.status}
                                    onChange={(e) => handleTaskStatusUpdate(t.id, e.target.value, t)} 
                                    style={{ 
                                      padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, 
                                      background: isCompleted ? "rgba(0,0,0,0.2)" : sc.bg, border: `1px solid ${sc.border}`, color: sc.text, cursor: "pointer" 
                                    }}
                                  >
                                    {["Pending","Under Process","Waiting Client","Completed","Cancelled"].map(s => <option key={s} value={s} style={{background: "#0a1612"}}>{s}</option>)}
                                  </select>
                                </div>
                                <p className="text-xs mt-1" style={{ color: isCompleted ? "rgba(200, 212, 208, 0.7)" : "var(--text-muted)" }}>
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
                )}

                {/* TAB 2: INVESTMENT PORTFOLIO */}
                {activeTab === "portfolio" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="flex justify-end mb-4">
                      <span className="text-xs font-bold px-3 py-1.5 rounded-lg border" style={{ background: "rgba(0,130,84,0.1)", borderColor: "rgba(0,130,84,0.3)", color: "var(--brand-green)" }}>
                        Total SIPs: ₹{getSIPTotal(selected.investments).toLocaleString('en-IN')}
                      </span>
                    </div>

                    {Object.keys(groupedInvestments).length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995] mb-4">No investment records found.</p>
                        <button onClick={() => openEdit(selected)} className="text-xs font-bold text-brand-green border border-brand-green/30 px-4 py-2 rounded-lg hover:bg-brand-green hover:text-white transition-all">
                          + Add First Investment
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-6 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                        {Object.entries(groupedInvestments).map(([folio, invs]) => (
                          <div key={folio} className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                            <div className="mb-4">
                              <p className="text-[10px] uppercase font-bold text-[#889995] mb-1">Folio Number</p>
                              <p className="text-sm font-mono text-white tracking-wider">{folio}</p>
                            </div>
                            
                            <div className="space-y-3">
                              {invs.map((inv, idx) => {
                                const isExpanded = expandedInv === inv.xsip_reg_no;
                                return (
                                  <div key={idx} className="rounded-lg overflow-hidden transition-all" style={{ border: isExpanded ? "1px solid var(--brand-green)" : "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}>
                                    <div 
                                      className="p-3 flex items-center justify-between cursor-pointer hover:bg-white/5"
                                      onClick={() => setExpandedInv(isExpanded ? null : inv.xsip_reg_no)}
                                    >
                                      <div>
                                        <p className="text-sm font-bold text-brand-green">{inv.scheme_name}</p>
                                        <p className="text-[10px] font-mono mt-1 text-[#889995]">xSIP: {inv.xsip_reg_no}</p>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <div className="text-right">
                                          <p className="text-sm font-bold text-white">
                                            {inv.installment_amount !== "-" && !isNaN(inv.installment_amount) ? `₹${Number(inv.installment_amount).toLocaleString('en-IN')}` : inv.installment_amount}
                                          </p>
                                          <p className="text-[9px] uppercase tracking-wider text-[#889995] mt-0.5">{inv.frequency_type}</p>
                                        </div>
                                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
                                      </div>
                                    </div>

                                    {isExpanded && (
                                      <div className="p-3 border-t border-white/5 bg-black/40 grid grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                                        <div className="flex items-center gap-2">
                                          <Calendar className="w-3 h-3 text-brand-green" />
                                          <div>
                                            <p className="text-[8px] uppercase tracking-wider text-[#889995]">Start Date</p>
                                            <p className="text-[10px] text-white">{inv.start_date}</p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Calendar className="w-3 h-3 text-[#f87171]" />
                                          <div>
                                            <p className="text-[8px] uppercase tracking-wider text-[#889995]">End Date</p>
                                            <p className="text-[10px] text-white">{inv.end_date}</p>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}