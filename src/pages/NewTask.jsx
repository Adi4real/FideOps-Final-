const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState, useEffect, useRef } from "react";

import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { Search, CheckCircle2, Loader2 } from "lucide-react";

const RM_LIST = ["Ujjwal", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel", "Uday", "Joel", "Manny", "Prince"];

const CATEGORY_ACTIONS = {
  "Transaction": [
    "SIP Registration", "SIP Modification", "SIP Cancellation",
    "Redemption", "Lump Sum Purchase", "Switch", "NFO Application"
  ],
  "Service": [
    "Account Statement", "Capital Gains Statement", "Nomination Update",
    "Bank Mandate", "Other"
  ],
  "KYC": [
    "KYC Update", "KYC Verification", "KYC Modification", "Physical KYC", "eKYC"
  ],
  "Portfolio Review": [
    "SIP Switch", "SIP Stop", "SIP Top-up", "SIP Restart", "SIP Pause"
  ],
};

const CHANNELS = ["Call", "WhatsApp", "Email", "Meeting"];
const PRIORITIES = ["High", "Medium", "Low"];

function getFinancialYear() {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() >= 3 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}
function getFYShort() {
  return getFinancialYear().split("-")[1].slice(2);
}

const iStyle = {
  width: "100%", padding: "10px 14px",
  background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10, color: "#c8d4d0", fontSize: 13,
};
const labelStyle = {
  display: "block", fontSize: 10, fontWeight: 700,
  color: "#889995", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5,
};
const sectionLabel = {
  fontSize: 10, fontWeight: 800, color: "#889995",
  textTransform: "uppercase", letterSpacing: 2, marginBottom: 12,
  paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.06)",
};

export default function NewTask() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [clientQuery, setClientQuery] = useState("");
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const suggestRef = useRef(null);

  const [form, setForm] = useState({
    entry_date: format(new Date(), "yyyy-MM-dd"),
    client_name: "", client_code: "", rm_assigned: "", branch: "",
    category: "Service", action: "", product_name: "", notes: "",
    amount: "", priority: "Medium", assigned_to: "",
    follow_up_date: "", channel: "Call", status: "Pending",
    financial_year: getFinancialYear(),
  });

  useEffect(() => {
    db.entities.Client.list("client_name", 1000).then(setClients);
  }, []);

  useEffect(() => {
    if (clientQuery.length >= 2) {
      const q = clientQuery.toLowerCase();
      setClientSuggestions(
        clients.filter(c =>
          c.client_name?.toLowerCase().includes(q) ||
          c.client_code?.toLowerCase().includes(q)
        ).slice(0, 8)
      );
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [clientQuery, clients]);

  const selectClient = (c) => {
    setClientQuery(c.client_name);
    setForm(f => ({ ...f, client_name: c.client_name, client_code: c.client_code, rm_assigned: c.rm_assigned || "", branch: c.branch || "" }));
    setShowSuggestions(false);
  };

  const set = (k, v) => {
    if (k === "category") {
      setForm(f => ({ ...f, category: v, action: "" }));
    } else {
      setForm(f => ({ ...f, [k]: v }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const allTasks = await db.entities.Task.list("-serial_number", 1);
    const serial = (allTasks[0]?.serial_number || 0) + 1;
    const task_id = `FW-${getFYShort()}-${String(serial).padStart(4, "0")}`;
    await db.entities.Task.create({ ...form, amount: form.amount ? parseFloat(form.amount) : undefined, serial_number: serial, task_id });
    setSaved(true);
    setTimeout(() => navigate(createPageUrl("LiveTasks")), 1200);
  };

  if (saved) {
    return (
      <div style={{ background: "var(--bg-black)", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(0,130,84,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CheckCircle2 style={{ width: 32, height: 32, color: "#4ade80" }} />
        </div>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#c8d4d0" }}>Task Created Successfully!</p>
        <p style={{ fontSize: 13, color: "#889995" }}>Redirecting to Live Tasks...</p>
      </div>
    );
  }

  const actions = CATEGORY_ACTIONS[form.category] || [];

  return (
    <div style={{ background: "var(--bg-black)", minHeight: "100vh", padding: "32px 24px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#c8d4d0" }}>New Task</h1>
          <p style={{ fontSize: 13, color: "#889995", marginTop: 4 }}>Create a new client service task</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 28, display: "flex", flexDirection: "column", gap: 28 }}>

            {/* Client Info */}
            <div>
              <p style={sectionLabel}>Client Information</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "1 / -1", position: "relative" }} ref={suggestRef}>
                  <label style={labelStyle}>Client Name *</label>
                  <div style={{ position: "relative" }}>
                    <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#889995" }} />
                    <input
                      style={{ ...iStyle, paddingLeft: 36 }}
                      placeholder="Type 2+ letters to search clients..."
                      value={clientQuery}
                      onChange={e => setClientQuery(e.target.value)}
                    />
                  </div>
                  {showSuggestions && clientSuggestions.length > 0 && (
                    <div style={{ position: "absolute", zIndex: 50, top: "100%", left: 0, right: 0, marginTop: 4, background: "#0e1e18", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                      {clientSuggestions.map(c => (
                        <button key={c.id} type="button" onClick={() => selectClient(c)}
                          style={{ width: "100%", textAlign: "left", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, color: "inherit" }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(0,130,84,0.12)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(0,130,84,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#4ade80", flexShrink: 0 }}>
                            {c.client_name?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 600, color: "#c8d4d0", margin: 0 }}>{c.client_name}</p>
                            <p style={{ fontSize: 11, color: "#889995", margin: 0 }}>{c.client_code} · {c.branch}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Client Code</label>
                  <input style={{ ...iStyle, opacity: 0.6 }} value={form.client_code} readOnly placeholder="Auto-filled" />
                </div>
                <div>
                  <label style={labelStyle}>RM Assigned</label>
                  <input style={{ ...iStyle, opacity: 0.6 }} value={form.rm_assigned} readOnly placeholder="Auto-filled" />
                </div>
                <div>
                  <label style={labelStyle}>Branch</label>
                  <input style={{ ...iStyle, opacity: 0.6 }} value={form.branch} readOnly placeholder="Auto-filled" />
                </div>
                <div>
                  <label style={labelStyle}>Entry Date</label>
                  <input type="date" style={{ ...iStyle, opacity: 0.6 }} value={form.entry_date} readOnly />
                </div>
              </div>
            </div>

            {/* Task Details */}
            <div>
              <p style={sectionLabel}>Task Details</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={labelStyle}>Category *</label>
                  <select style={iStyle} value={form.category} onChange={e => set("category", e.target.value)}>
                    {Object.keys(CATEGORY_ACTIONS).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Action *</label>
                  <select style={iStyle} value={form.action} onChange={e => set("action", e.target.value)} required>
                    <option value="">Select action...</option>
                    {actions.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Product Name</label>
                  <input style={iStyle} placeholder="e.g. HDFC Top 100" value={form.product_name} onChange={e => set("product_name", e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Amount (₹)</label>
                  <input type="number" style={iStyle} placeholder="Optional" value={form.amount} onChange={e => set("amount", e.target.value)} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Notes / Details</label>
                  <textarea rows={3} style={iStyle} placeholder="Additional notes..." value={form.notes} onChange={e => set("notes", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Assignment */}
            <div>
              <p style={sectionLabel}>Assignment & Follow-up</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={labelStyle}>Priority *</label>
                  <select style={iStyle} value={form.priority} onChange={e => set("priority", e.target.value)}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Assigned To *</label>
                  <select style={iStyle} value={form.assigned_to} onChange={e => set("assigned_to", e.target.value)} required>
                    <option value="">Select RM...</option>
                    {RM_LIST.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Follow-up Date *</label>
                  <input type="date" style={iStyle} value={form.follow_up_date} onChange={e => set("follow_up_date", e.target.value)} required />
                </div>
                <div>
                  <label style={labelStyle}>Channel *</label>
                  <select style={iStyle} value={form.channel} onChange={e => set("channel", e.target.value)}>
                    {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
              <button type="submit" disabled={saving} style={{ padding: "11px 32px", borderRadius: 12, fontSize: 14, fontWeight: 700, background: saving ? "rgba(0,130,84,0.4)" : "#008254", color: "white", border: "none", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                {saving ? <><Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> Creating...</> : "Create Task"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}