import { useState, useEffect } from "react";
import { Search, Plus, Upload, ChevronRight, Pencil, Trash2, RefreshCw, CalendarPlus, UserCheck } from "lucide-react";

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

import LeadForm from "@/components/leads/LeadForm.jsx";
import LeadImport from "@/components/leads/LeadImport.jsx";

function makeGCalLeadLink(lead) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
  const start = `${dateStr}T100000`;
  const end   = `${dateStr}T110000`;
  const title = encodeURIComponent(`[${lead.lead_code || "LEAD"}] ${lead.lead_name} — ${lead.action_stage || "Follow-up"}`);
  const details = encodeURIComponent(
    `Lead Code: ${lead.lead_code || ""}\nLead Name: ${lead.lead_name}\nRM Assigned: ${lead.rm_assigned || ""}\nBranch: ${lead.branch || ""}\nCategory: ${lead.lead_category || ""}\nStage: ${lead.action_stage || ""}${lead.notes ? `\nNotes: ${lead.notes}` : ""}`
  );
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
}

const LEAD_CATEGORIES = ["Normal Lead", "Strong Lead"];

// Updated Action Stages
const ACTION_STAGES = [
  "Meet Urgent", 
  "Upcoming Meeting", 
  "Financial Planning",
  "Meeting In-Person", 
  "Zoom Call", 
  "Meeting minutes", 
  "KYC Pending",
  "KYC Check", 
  "KYC Modify", 
  "NSE Form", 
  "eNACH Mandate",
  "Physical Mandate", 
  "Transaction to be initiated", 
  "App & Broadcast",
  "Onboarding Completed"
];

async function generateLeadCode(leads) {
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `LD-${year}-`;
  const nums = leads
    .map(l => l.lead_code)
    .filter(c => c && c.startsWith(prefix))
    .map(c => parseInt(c.replace(prefix, ""), 10))
    .filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

const categoryColor = {
  "Normal Lead": { bg: "rgba(100,116,139,0.2)", text: "#94a3b8" },
  "Strong Lead": { bg: "rgba(0,130,84,0.2)", text: "#4ade80" },
};

const stageColor = (stage) => {
  if (stage === "Onboarding Completed") return { bg: "rgba(0,130,84,0.25)", text: "#4ade80" };
  if (stage === "Transaction to be initiated") return { bg: "rgba(56,189,248,0.2)", text: "#7dd3fc" };
  if (["KYC Pending", "KYC Check", "KYC Modify"].includes(stage)) return { bg: "rgba(245,158,11,0.2)", text: "#fbbf24" };
  if (stage === "Meet Urgent") return { bg: "rgba(220,38,38,0.2)", text: "#f87171" };
  if (stage === "Upcoming Meeting") return { bg: "rgba(245,158,11,0.2)", text: "#fbbf24" };
  if (stage === "Financial Planning") return { bg: "rgba(99,102,241,0.2)", text: "#a5b4fc" };
  return { bg: "rgba(255,255,255,0.06)", text: "#889995" };
};

const glassCard = { background: "var(--glass)", border: "1px solid var(--border)", borderRadius: 16, backdropFilter: "blur(10px)" };

export default function LeadClients() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Active"); // <-- New Status Filter
  const [filterCat, setFilterCat] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [converting, setConverting] = useState(null);

  // Firestore Real-time Listener
  useEffect(() => {
    const leadsRef = collection(db, "leads");
    const q = query(leadsRef, orderBy("created_at", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLeads(leadData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const totalActive = leads.filter(l => l.status !== "Converted").length;
  const totalConverted = leads.filter(l => l.status === "Converted").length;

  // Apply Filters
  let filtered = leads;
  
  if (filterStatus === "Active") {
    filtered = filtered.filter(l => l.status !== "Converted");
  } else if (filterStatus === "Converted") {
    filtered = filtered.filter(l => l.status === "Converted");
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(l =>
      l.lead_name?.toLowerCase().includes(q) ||
      l.lead_code?.toLowerCase().includes(q) ||
      l.rm_assigned?.toLowerCase().includes(q) ||
      l.branch?.toLowerCase().includes(q)
    );
  }
  if (filterCat !== "all") filtered = filtered.filter(l => l.lead_category === filterCat);
  if (filterStage !== "all") filtered = filtered.filter(l => l.action_stage === filterStage);

  const handleSave = async (data) => {
    try {
      if (data.id) {
        const leadRef = doc(db, "leads", data.id);
        await updateDoc(leadRef, data);
      } else {
        const code = await generateLeadCode(leads);
        await addDoc(collection(db, "leads"), { 
          ...data, 
          lead_code: code, 
          status: "Active",
          created_at: serverTimestamp()
        });
      }
      setShowForm(false); 
      setEditLead(null);
    } catch (error) {
      console.error("Error saving lead:", error);
    }
  };

  const handleDelete = async (lead) => {
    if (!window.confirm(`Delete "${lead.lead_name}" permanently?`)) return;
    try {
      await deleteDoc(doc(db, "leads", lead.id));
    } catch (error) {
      console.error("Error deleting lead:", error);
    }
  };

  const handleStageChange = async (lead, newStage) => {
    try {
      const leadRef = doc(db, "leads", lead.id);

      // --- LOGIC 1: Transaction to be initiated ---
      if (newStage === "Transaction to be initiated") {
        setConverting(lead.id);
        
        let clientId = lead.converted_client_id;

        if (!clientId) {
          const clientCode = lead.lead_code ? lead.lead_code.replace("LD-", "FW-C-") : `FW-C-${Date.now()}`;
          const newClient = await addDoc(collection(db, "clients"), {
            client_code: clientCode,
            client_name: lead.lead_name,
            rm_assigned: lead.rm_assigned || "-",
            branch: lead.branch || "-",
            client_info: lead.notes || "-",
            client_action: "-",
            holding_nature: "SINGLE",
            tax_status: "INDIVIDUAL",
            investments: [],
            relations: [],
            created_at: serverTimestamp(),
            converted_from_lead: lead.id
          });
          clientId = newClient.id;
        }

        await updateDoc(leadRef, {
          action_stage: newStage,
          converted_client_id: clientId || null
        });
        
        setConverting(null);

      // --- LOGIC 2: Onboarding Completed ---
      } else if (newStage === "Onboarding Completed") {
        setConverting(lead.id);
        
        let clientId = lead.converted_client_id;

        if (!clientId) {
          const clientCode = lead.lead_code ? lead.lead_code.replace("LD-", "FW-C-") : `FW-C-${Date.now()}`;
          const newClient = await addDoc(collection(db, "clients"), {
            client_code: clientCode,
            client_name: lead.lead_name,
            rm_assigned: lead.rm_assigned || "-",
            branch: lead.branch || "-",
            client_info: lead.notes || "-",
            client_action: "-",
            holding_nature: "SINGLE",
            tax_status: "INDIVIDUAL",
            investments: [],
            relations: [],
            created_at: serverTimestamp(),
            converted_from_lead: lead.id
          });
          clientId = newClient.id;
        }

        await updateDoc(leadRef, {
          action_stage: newStage,
          status: "Converted",
          converted_client_id: clientId || null
        });
        
        setConverting(null);

      // --- LOGIC 3: Any other stage ---
      } else {
        await updateDoc(leadRef, { action_stage: newStage });
      }

    } catch (error) {
      console.error("Error updating stage:", error);
      setConverting(null);
    }
  };

  const openEdit = (lead) => { setEditLead(lead); setShowForm(true); };

  const selectStyle = {
    padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
    background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", cursor: "pointer",
  };

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh" }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, color: "#008254", background: "rgba(0,130,84,0.12)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(0,130,84,0.25)" }}>
              Business Development
            </span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "#c8d4d0" }}>Lead Clients</h1>
          <p className="text-sm mt-1" style={{ color: "#889995" }}>{totalActive} active prospects</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => {}} style={{ padding: "8px 10px", borderRadius: 10, background: "var(--glass)", border: "1px solid var(--border)", color: "#889995", cursor: "pointer" }}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowImport(v => !v)} style={{ padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "transparent", border: "1px solid #008254", color: "#008254", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Upload className="w-4 h-4" /> Import Excel
          </button>
          <button onClick={() => { setEditLead(null); setShowForm(true); }} style={{ padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "#008254", color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus className="w-4 h-4" /> Add Lead
          </button>
        </div>
      </div>

      {showImport && <LeadImport onImportDone={() => setShowImport(false)} onClose={() => setShowImport(false)} />}
      {showForm && <LeadForm lead={editLead} onSave={handleSave} onClose={() => { setShowForm(false); setEditLead(null); }} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#889995" }} />
          <input
            style={{ paddingLeft: 34, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: 10, background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 13, width: 220 }}
            placeholder="Search leads..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        
        {/* NEW Lead Status Filter */}
        <select style={selectStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="Active">Active Leads</option>
          <option value="Converted">Converted Clients</option>
          <option value="All">All Leads</option>
        </select>

        <select style={selectStyle} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="all">All Categories</option>
          {LEAD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={selectStyle} value={filterStage} onChange={e => setFilterStage(e.target.value)}>
          <option value="all">All Stages</option>
          {ACTION_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ ...glassCard, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
                {["Lead Code", "Lead Name", "RM Assigned", "Branch", "Lead Source", "Category", "Action Stage", ""].map(h => (
                  <th key={h} style={{ padding: "14px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#889995" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: "#889995" }}>Loading leads...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: "#889995" }}>
                  {search || filterCat !== "all" || filterStage !== "all" || filterStatus !== "Active" ? "No leads match your filters." : "No leads yet. Add one or import from Excel."}
                </td></tr>
              ) : filtered.map((lead, i) => {
                const cat = categoryColor[lead.lead_category] || { bg: "rgba(255,255,255,0.06)", text: "#889995" };
                const stg = stageColor(lead.action_stage);
                const isConverting = converting === lead.id;
                const isConverted = lead.status === "Converted";

                return (
                  <tr key={lead.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                    <td style={{ padding: "14px 12px", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#008254" }}>{lead.lead_code || "—"}</td>
                    <td style={{ padding: "14px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(0,130,84,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#4ade80", flexShrink: 0 }}>
                          {lead.lead_name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span style={{ fontWeight: 600, color: "#c8d4d0", textDecoration: isConverted ? "line-through" : "none" }}>{lead.lead_name}</span>
                      </div>
                    </td>
                    <td style={{ padding: "14px 12px", color: "#889995" }}>{lead.rm_assigned || "—"}</td>
                    <td style={{ padding: "14px 12px", color: "#889995" }}>{lead.branch || "—"}</td>
                    <td style={{ padding: "14px 12px", color: "#889995" }}>{lead.lead_source || "—"}</td>
                    <td style={{ padding: "14px 12px" }}>
                      {lead.lead_category ? (
                        <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: cat.bg, color: cat.text }}>{lead.lead_category}</span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "14px 12px" }}>
                      {isConverted ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }}>
                          <UserCheck className="w-3.5 h-3.5" /> Converted to Client
                        </span>
                      ) : (
                        <select
                          value={lead.action_stage || ""}
                          onChange={e => handleStageChange(lead, e.target.value)}
                          disabled={isConverting}
                          style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: stg.bg, border: "1px solid rgba(255,255,255,0.08)", color: stg.text, cursor: "pointer" }}
                        >
                          <option value="">Select Stage</option>
                          {ACTION_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                      {isConverting && <span style={{ fontSize: 10, color: "#4ade80", marginLeft: 6 }}>Processing...</span>}
                    </td>
                    <td style={{ padding: "14px 12px" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <a href={makeGCalLeadLink(lead)} target="_blank" rel="noopener noreferrer" style={{ padding: "6px", borderRadius: 8, background: "rgba(66,133,244,0.1)", border: "1px solid rgba(66,133,244,0.25)", color: "#60a5fa", cursor: "pointer", display: "inline-flex", alignItems: "center" }} title="Add to Google Calendar">
                          <CalendarPlus className="w-3.5 h-3.5" />
                        </a>
                        <button onClick={() => openEdit(lead)} style={{ padding: "6px", borderRadius: 8, background: "rgba(0,130,84,0.1)", border: "1px solid rgba(0,130,84,0.2)", color: "#4ade80", cursor: "pointer" }} title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(lead)} style={{ padding: "6px", borderRadius: 8, background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.15)", color: "#f87171", cursor: "pointer" }} title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "#889995" }}>
            Showing {filtered.length} leads · {totalActive} Active · {totalConverted} Converted
          </div>
        )}
      </div>
    </div>
  );
}