import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { Search, CheckCircle2, Loader2, X, Plus } from "lucide-react";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from "firebase/firestore"; 

const RM_LIST = ["Ujjwal", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel", "Uday", "Joel", "Manny", "Prince"];

const RM_PHONES = {
  "Ujjwal": "917010154937",
  "Manny": "919962916244",
  "Uday": "919884924029",
  "Joel": "91XXXXXXXXXX",
  "Prince": "919201091417",
};

// --- Helper: Convert Number to Indian Words ---
function numberToWords(num) {
  if (num === 0) return "Zero";
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convert = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 !== 0 ? " and " + convert(n % 100) : "");
    if (n < 100000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 !== 0 ? " " + convert(n % 1000) : "");
    if (n < 10000000) return convert(Math.floor(n / 100000)) + " Lakh" + (n % 100000 !== 0 ? " " + convert(n % 100000) : "");
    return convert(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 !== 0 ? " " + convert(n % 10000000) : "");
  };

  return convert(parseInt(num)) + " Rupees Only";
}

function getBranch(rm) {
  if (!rm) return "";
  if (rm === "Ujjwal and Joel") return "Katni Branch";
  if (rm.includes("Ujjwal") || rm.includes("Manny")) return "Chennai Branch";
  if (rm.includes("Uday") || rm.includes("Joel") || rm.includes("Prince")) return "Katni Branch";
  return rm;
}

function getRecipientPhone(rmName) {
  if (rmName === "Ujjwal and Joel") return RM_PHONES["Ujjwal"]; 
  if (rmName.includes("Ujjwal")) return RM_PHONES["Ujjwal"];
  if (rmName.includes("Manny")) return RM_PHONES["Manny"];
  return RM_PHONES[rmName] || "";
}

const POLICY_ACTIONS = [
  "New Policy Purchase", "Policy Renewal", "Policy Servicing", "Policy Surrender",
  "Policy Claim Assistance", "Policy Revival", "Policy Nominee Update", "Policy Detail Update / Correction"
];

const CATEGORY_ACTIONS = {
  "Transaction": [
    "SIP Registration", "SIP Modification", "SIP Cancellation",
    "Redemption", "Lumpsum Purchase", "Lumpsum & SIP", "Switch", "NFO Purchase"
  ],
  "Service": ["Account Statement", "Capital Gains Statement", "Nomination Update", "Bank Mandate", "Other"],
  "KYC": ["KYC Update", "KYC Verification", "KYC Modification", "Physical KYC", "eKYC"],
  "Portfolio Review": ["SIP Switch", "SIP Stop", "SIP Top-up", "SIP Restart", "SIP Pause", "Scheme Switch", "Scheme Redemption", "Scheme Re-investment"],
  "Term": POLICY_ACTIONS,
  "Health": POLICY_ACTIONS,
};

const CHANNELS = ["Call", "WhatsApp", "Email", "Meeting"];
const PRIORITIES = ["High", "Medium", "Low"];

function getFinancialYear() {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() >= 3 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}
function getFYShort() { return getFinancialYear().split("-")[1].slice(2); }

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
  const suggestRef = useRef(null);

  const [productInput, setProductInput] = useState("");
  const [productTags, setProductTags] = useState([]);

  const [form, setForm] = useState({
    entry_date: format(new Date(), "yyyy-MM-dd"),
    client_name: "", client_code: "", rm_assigned: "", branch: "",
    category: "Service", action: "", product_name: "", notes: "",
    amount: "", priority: "Medium", assigned_to: "",
    follow_up_date: "", channel: "Call", status: "Pending",
    financial_year: getFinancialYear(),
  });

  useEffect(() => {
    const fetchClients = async () => {
      const q = query(collection(db, "clients"), orderBy("client_name"));
      const querySnapshot = await getDocs(q);
      setClients(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchClients();
  }, []);

  useEffect(() => {
    if (clientQuery.length >= 2) {
      const q = clientQuery.toLowerCase();
      const filtered = clients.filter(c => {
        const displayName = `${c.client_name} ${c.tax_status && c.tax_status !== "-" ? `(${c.tax_status})` : ""}`.toLowerCase();
        return displayName.includes(q) || c.client_code?.toLowerCase().includes(q);
      }).slice(0, 8);
      
      setClientSuggestions(filtered);

      const exactMatch = clients.find(c => `${c.client_name} ${c.tax_status && c.tax_status !== "-" ? `(${c.tax_status})` : ""}` === clientQuery);
      if (!exactMatch) setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [clientQuery, clients]);

  const selectClient = (c) => {
    const displayName = `${c.client_name} ${c.tax_status && c.tax_status !== "-" ? `(${c.tax_status})` : ""}`;
    setClientQuery(displayName);
    
    setForm(f => ({ ...f, client_name: c.client_name, client_code: c.client_code, rm_assigned: c.rm_assigned || "", branch: c.branch || "" }));
    setShowSuggestions(false);
  };

  const set = (k, v) => {
    if (k === "category") setForm(f => ({ ...f, category: v, action: "" }));
    else setForm(f => ({ ...f, [k]: v }));
  };

  const addTag = () => {
    const val = productInput.trim();
    if (val && !productTags.includes(val)) {
      setProductTags([...productTags, val]);
      setProductInput("");
    }
  };

  const removeTag = (t) => setProductTags(productTags.filter(tag => tag !== t));

  const handleProductKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
  };

  const getAmountLabel = () => (form.category === "Transaction" && form.action) ? `${form.action} Amount (₹)` : "Total Amount (₹)";

  const triggerWhatsApp = async (taskData) => {
    const phone = getRecipientPhone(taskData.assigned_to);
    if (!phone) return;
    const INSTANCE_ID = "instance165379"; 
    const TOKEN = "4j68vvv8qw5unoo8";
    
    // Generate the full URL dynamically based on where the app is running
    const dashboardUrl = `${window.location.origin}${createPageUrl("LiveTasks")}`;
    
    const message = `*New Task Assigned!* 🚀\n\n*ID:* ${taskData.task_id}\n*Client:* ${taskData.client_name}\n*Work:* ${taskData.action}\n*Follow-up:* ${taskData.follow_up_date}\n\n🔗 *View Dashboard:* ${dashboardUrl}`;
    
    try {
      const params = new URLSearchParams();
      params.append('token', TOKEN); params.append('to', phone); params.append('body', message);
      await fetch(`https://api.ultramsg.com/${INSTANCE_ID}/messages/chat`, { method: 'POST', body: params });
    } catch (e) { console.error(e); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const finalProductString = productTags.join("\n");
    const taskBranch = getBranch(form.assigned_to); 
    try {
      const tasksRef = collection(db, "tasks");
      const q = query(tasksRef, orderBy("serial_number", "desc"), limit(1));
      const querySnapshot = await getDocs(q);
      let serial = !querySnapshot.empty ? (querySnapshot.docs[0].data().serial_number || 0) + 1 : 1;
      const task_id = `FW-${getFYShort()}-${String(serial).padStart(4, "0")}`;
      const newTaskData = { ...form, branch: taskBranch, product_name: finalProductString, amount: form.amount ? parseFloat(form.amount) : null, serial_number: serial, task_id, created_at: serverTimestamp() };
      await addDoc(collection(db, "tasks"), newTaskData);
      await triggerWhatsApp(newTaskData);
      navigate(createPageUrl("LiveTasks"));
    } catch (error) { setSaving(false); console.error(error); }
  };

  return (
    <div style={{ background: "var(--bg-black)", minHeight: "100vh", padding: "32px 24px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#c8d4d0" }}>New Task</h1>
        <p style={{ fontSize: 13, color: "#889995", marginBottom: 28 }}>Create a new client service task</p>

        <form onSubmit={handleSubmit}>
          <div style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 28, display: "flex", flexDirection: "column", gap: 28 }}>
            
            {/* Client Info Section */}
            <div>
              <p style={sectionLabel}>Client Information</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "1 / -1", position: "relative" }} ref={suggestRef}>
                  <label style={labelStyle}>Client Name *</label>
                  <div style={{ position: "relative" }}>
                    <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#889995" }} />
                    <input style={{ ...iStyle, paddingLeft: 36 }} placeholder="Search..." value={clientQuery} onChange={e => setClientQuery(e.target.value)} onFocus={() => clientQuery.length >= 2 && setShowSuggestions(true)} />
                  </div>
                  {showSuggestions && clientSuggestions.length > 0 && (
                    <div style={{ position: "absolute", zIndex: 50, top: "100%", left: 0, right: 0, background: "#0e1e18", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, marginTop: 4 }}>
                      {clientSuggestions.map(c => (
                        <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); selectClient(c); }} style={{ width: "100%", textAlign: "left", padding: "10px 16px", background: "transparent", color: "white", cursor: "pointer", border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          {c.client_name} {c.tax_status && c.tax_status !== "-" ? <span style={{fontSize: "10px", color: "#4ade80", marginLeft: "6px", fontWeight: "bold"}}>({c.tax_status})</span> : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div><label style={labelStyle}>Client Code</label><input style={{...iStyle, opacity: 0.6}} value={form.client_code} readOnly /></div>
                <div><label style={labelStyle}>RM Assigned</label><input style={{...iStyle, opacity: 0.6}} value={form.rm_assigned} readOnly /></div>
                <div><label style={labelStyle}>Branch</label><input style={{...iStyle, opacity: 0.6}} value={form.branch} readOnly /></div>
                <div><label style={labelStyle}>Entry Date</label><input type="date" style={{...iStyle, opacity: 0.6}} value={form.entry_date} readOnly /></div>
              </div>
            </div>

            {/* Task Details Section */}
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
                    {CATEGORY_ACTIONS[form.category]?.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Product Names</label>
                  <input style={iStyle} placeholder="Type comma or Enter to add" value={productInput} onChange={e => setProductInput(e.target.value)} onKeyDown={handleProductKeyDown} onBlur={addTag} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    {productTags.map((tag, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,130,84,0.15)", border: "1px solid rgba(0,130,84,0.3)", padding: "4px 10px", borderRadius: 8, color: "#4ade80", fontSize: 12, fontWeight: 600 }}>
                        {tag} <X className="w-3.5 h-3.5 cursor-pointer" onClick={() => removeTag(tag)} />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>{getAmountLabel()}</label>
                  <input type="number" style={iStyle} placeholder="Optional" value={form.amount} onChange={e => set("amount", e.target.value)} />
                  {form.amount && (
                    <p style={{ fontSize: 11, color: "#4ade80", marginTop: 6, fontWeight: 600, fontStyle: "italic" }}>
                      {numberToWords(form.amount)}
                    </p>
                  )}
                </div>

                <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Notes</label><textarea rows={3} style={iStyle} value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
              </div>
            </div>

            {/* Assignment & Follow-up */}
            <div>
              <p style={sectionLabel}>Assignment & Follow-up</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div><label style={labelStyle}>Priority</label><select style={iStyle} value={form.priority} onChange={e => set("priority", e.target.value)}>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                <div><label style={labelStyle}>Assigned To</label><select style={iStyle} value={form.assigned_to} onChange={e => set("assigned_to", e.target.value)} required><option value="">Select RM...</option>{RM_LIST.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                <div><label style={labelStyle}>Follow-up Date</label><input type="date" style={iStyle} value={form.follow_up_date} onChange={e => set("follow_up_date", e.target.value)} required /></div>
                <div><label style={labelStyle}>Channel</label><select style={iStyle} value={form.channel} onChange={e => set("channel", e.target.value)}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={saving} style={{ padding: "11px 32px", borderRadius: 12, background: "#008254", color: "white", border: "none", fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Creating..." : "Create Task"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}