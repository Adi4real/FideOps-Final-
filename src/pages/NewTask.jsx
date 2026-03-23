import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { Search, CheckCircle2, Loader2, X, Plus, Pencil, Check } from "lucide-react";

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

function numberToWords(num) {
  if (num === 0 || !num) return "Zero";
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

// --- BULLETPROOF PARSER ---
function parseExistingInvestments(data) {
  let items = [];

  if (Array.isArray(data)) {
    items = data.map(item => {
      if (typeof item === 'string') return { productName: item, amount: "", type: "SIP", isEditable: false, isExisting: true, selected: false };
      
      const keys = Object.keys(item);
      const nameKey = keys.find(k => k.toLowerCase().includes('scheme') || k.toLowerCase().includes('fund') || k.toLowerCase().includes('product') || k.toLowerCase() === 'name');
      const amountKey = keys.find(k => {
        const kLower = k.toLowerCase();
        if (kLower === 'xsip' || kLower.includes('reg') || kLower.includes('urn')) return false;
        return kLower.includes('amount') || kLower.includes('value') || kLower === 'sip';
      });

      let rawAmount = "";
      if (amountKey && item[amountKey]) {
        const valAsString = String(item[amountKey]).replace(/,/g, '');
        if (valAsString.length < 10) rawAmount = valAsString;
      }
      
      let cleanAmount = rawAmount.replace(/[^\d.]/g, ''); 

      return {
        productName: nameKey ? String(item[nameKey]) : "",
        amount: cleanAmount,
        type: item.type || "SIP",
        isEditable: false,
        isExisting: true,
        selected: false // Added for the selection toggle
      };
    });
  } else if (typeof data === 'string') {
    const lines = data.split(/[\n,]/).filter(l => l.trim() !== "");
    items = lines.map(line => {
      let name = line.trim();
      let amount = "";
      let type = "SIP";

      const amtMatch = name.match(/\(?(?:₹|Rs\.?|INR)\s*([\d,]+(?:[.]\d+)?)\)?/i) || name.match(/\b([1-9]\d{2,7})\b/); 
      if (amtMatch) {
        let potentialAmount = amtMatch[1].replace(/,/g, '');
        if (potentialAmount.length < 10) {
           amount = potentialAmount;
           name = name.replace(amtMatch[0], '').trim();
        }
      }

      const typeMatch = name.match(/\[(.*?)\]/);
      if (typeMatch) {
        type = typeMatch[1].toUpperCase();
        name = name.replace(typeMatch[0], '').trim();
      }

      name = name.replace(/^[-:\s]+|[-:\s]+$/g, '');
      return { productName: name, amount, type, isEditable: false, isExisting: true, selected: false };
    });
  }

  return items.filter(i => i.productName !== "");
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

const CATEGORY_ACTIONS = {
  "Transaction": [
    "SIP Registration", "SIP Cancellation",
    "Redemption", "Lumpsum Purchase", "Lumpsum & SIP", "Switch", "NFO Purchase"
  ],
  "Service": ["Account Statement", "Capital Gains Statement", "Nomination Update", "Bank Mandate", "Other"],
  "KYC": ["KYC Update", "KYC Verification", "KYC Modification", "Physical KYC", "eKYC"],
  "Portfolio Review": ["SIP Switch", "SIP Stop", "SIP Top-up", "SIP Restart", "SIP Pause", "Scheme Switch", "Scheme Redemption", "Scheme Re-investment"],
  "Term": ["New Policy Purchase", "Policy Renewal", "Policy Servicing", "Policy Surrender", "Policy Claim Assistance", "Policy Revival", "Policy Nominee Update", "Policy Detail Update / Correction"],
  "Health": ["New Policy Purchase", "Policy Renewal", "Policy Servicing", "Policy Surrender", "Policy Claim Assistance", "Policy Revival", "Policy Nominee Update", "Policy Detail Update / Correction"],
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
  
  const [transactionItems, setTransactionItems] = useState([{ productName: "", amount: "", type: "SIP", isEditable: true, isExisting: false, selected: false }]);

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

  // --- SMART AUTO-POPULATE TRIGGER ---
  useEffect(() => {
    const isTargetAction = form.category === "Transaction" && 
                           (form.action === "SIP Registration" || form.action === "SIP Cancellation");

    if (form.client_code && isTargetAction) {
      const clientData = clients.find(c => c.client_code === form.client_code);
      
      let portfolioData = null;
      if (clientData) {
        const keys = Object.keys(clientData);
        const targetKey = keys.find(k => k.toLowerCase().replace(/[^a-z]/g, '') === 'investmentportfolio') || 
                          keys.find(k => k.toLowerCase() === 'portfolio') || 
                          keys.find(k => k.toLowerCase() === 'investments') ||
                          keys.find(k => k.toLowerCase() === 'sips');
        portfolioData = targetKey ? clientData[targetKey] : null;
      }

      if (portfolioData) {
        const parsedItems = parseExistingInvestments(portfolioData);
        
        if (parsedItems.length === 0) {
          setTransactionItems([{ productName: "", amount: "", type: "SIP", isEditable: true, isExisting: false, selected: false }]);
        } else {
          // If SIP Registration: Show existing + one empty row for new
          if (form.action === "SIP Registration") {
            setTransactionItems([...parsedItems, { productName: "", amount: "", type: "SIP", isEditable: true, isExisting: false, selected: false }]);
          } else {
            // If SIP Cancellation: Just show the existing items so they can be selected
            setTransactionItems(parsedItems);
          }
        }
      } else {
        setTransactionItems([{ productName: "", amount: "", type: "SIP", isEditable: true, isExisting: false, selected: false }]);
      }
    } else {
      if (transactionItems.length !== 1 || transactionItems[0].productName !== "") {
        setTransactionItems([{ productName: "", amount: "", type: "SIP", isEditable: true, isExisting: false, selected: false }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_code, form.category, form.action, clients]);

  const selectClient = (c) => {
    const displayName = `${c.client_name} ${c.tax_status && c.tax_status !== "-" ? `(${c.tax_status})` : ""}`;
    setClientQuery(displayName);
    setForm(f => ({ 
      ...f, 
      client_name: c.client_name, 
      client_code: c.client_code, 
      rm_assigned: c.rm_assigned || "", 
      branch: c.branch || ""
    }));
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

  const addTransactionItem = () => {
    setTransactionItems([...transactionItems, { productName: "", amount: "", type: "SIP", isEditable: true, isExisting: false, selected: false }]);
  };
  const updateTransactionItem = (index, field, value) => {
    const newItems = [...transactionItems];
    newItems[index][field] = value;
    setTransactionItems(newItems);
  };
  const removeTransactionItem = (index) => {
    const newItems = transactionItems.filter((_, i) => i !== index);
    setTransactionItems(newItems);
  };

  // Toggle selection specifically for SIP Cancellation
  const toggleCancelSelection = (index) => {
    const newItems = [...transactionItems];
    newItems[index].selected = !newItems[index].selected;
    setTransactionItems(newItems);
  };

  // Only calculate total for the items that will actually be submitted
  const activeItemsForTotal = form.action === "SIP Cancellation" 
      ? transactionItems.filter(i => i.selected) 
      : form.action === "SIP Registration"
      ? transactionItems.filter(i => !i.isExisting)
      : transactionItems;

  const totalTransactionAmount = activeItemsForTotal.reduce((sum, item) => {
    const val = parseFloat(item.amount);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  const getAmountLabel = () => (form.category === "Transaction" && form.action) ? `${form.action} Amount (₹)` : "Total Amount (₹)";

  const triggerWhatsApp = async (taskData) => {
    const phone = getRecipientPhone(taskData.assigned_to);
    if (!phone) return;
    const INSTANCE_ID = "instance165379"; 
    const TOKEN = "4j68vvv8qw5unoo8";
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
    const taskBranch = getBranch(form.assigned_to); 

    let finalProductString = "";
    let finalAmount = null;

    if (form.category === "Transaction") {
      // Determine what actually gets submitted to the task
      let itemsToSubmit = [];
      if (form.action === "SIP Cancellation") {
        itemsToSubmit = transactionItems.filter(i => i.selected);
      } else if (form.action === "SIP Registration") {
        itemsToSubmit = transactionItems.filter(i => !i.isExisting);
      } else {
        itemsToSubmit = transactionItems;
      }

      const validItems = itemsToSubmit.filter(i => i.productName.trim() || i.amount);
      finalProductString = validItems.map(i => {
        let str = `${i.productName} (₹${i.amount || 0})`;
        if (form.action === "Lumpsum & SIP") str += ` [${i.type || 'SIP'}]`;
        return str;
      }).join("\n");
      
      finalAmount = totalTransactionAmount > 0 ? totalTransactionAmount : null;
    } else {
      finalProductString = productTags.join("\n");
      finalAmount = form.amount ? parseFloat(form.amount) : null;
    }

    try {
      const tasksRef = collection(db, "tasks");
      const qS = await getDocs(query(tasksRef, orderBy("serial_number", "desc"), limit(1)));
      let serial = !qS.empty ? (qS.docs[0].data().serial_number || 0) + 1 : 1;
      const task_id = `FW-${getFYShort()}-${String(serial).padStart(4, "0")}`;
      
      const newTaskData = { 
        ...form, 
        branch: taskBranch, 
        product_name: finalProductString, 
        amount: finalAmount, 
        serial_number: serial, 
        task_id, 
        created_at: serverTimestamp() 
      };

      await addDoc(collection(db, "tasks"), newTaskData);
      await triggerWhatsApp(newTaskData);
      navigate(createPageUrl("LiveTasks"));
    } catch (error) { 
      setSaving(false); 
      console.error(error); 
    }
  };

  return (
    <div style={{ background: "var(--bg-black)", minHeight: "100vh", padding: "32px 24px" }}>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
        
        /* --- CALENDAR ICON FIX (YELLOW) --- */
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="month"]::-webkit-calendar-picker-indicator {
          /* Translates the black native icon to yellow (#fbbf24) */
          filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%);
          cursor: pointer;
          opacity: 1;
        }
        input[type="date"], input[type="month"] {
          color-scheme: dark;
          color: #fbbf24 !important; /* Makes the date text yellow */
          font-weight: 700;
        }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#c8d4d0" }}>New Task</h1>
        <p style={{ fontSize: 13, color: "#889995", marginBottom: 28 }}>Create a new client service task</p>

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
                    {CATEGORY_ACTIONS[form.category]?.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                {form.category === "Transaction" ? (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>{form.action ? `${form.action} Details *` : "Investment Details *"}</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      
                      {/* --- SIP CANCELLATION UI (Checkboxes) --- */}
                      {form.action === "SIP Cancellation" ? (
                        <>
                          <p style={{ fontSize: 12, color: "#889995", marginBottom: "-4px" }}>Select the active SIPs to cancel:</p>
                          {transactionItems.filter(i => i.isExisting).map((item, idx) => (
                            <div 
                              key={idx} 
                              onClick={() => toggleCancelSelection(idx)}
                              style={{ 
                                display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                                background: item.selected ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.02)", 
                                border: item.selected ? "1px solid rgba(248,113,113,0.3)" : "1px dashed rgba(255,255,255,0.15)",
                                borderRadius: "12px", cursor: "pointer", transition: "all 0.2s ease-in-out" 
                              }}
                            >
                              <div style={{
                                width: 18, height: 18, borderRadius: 4, 
                                border: item.selected ? "none" : "1px solid #889995",
                                background: item.selected ? "#f87171" : "transparent", 
                                display: "flex", alignItems: "center", justifyContent: "center"
                              }}>
                                {item.selected && <Check size={12} color="white" />}
                              </div>
                              <div style={{ flex: 1 }}>
                                <span style={{ color: item.selected ? "#f87171" : "#c8d4d0", fontSize: "13px", fontWeight: 600, transition: "color 0.2s" }}>{item.productName}</span>
                              </div>
                              <div style={{ color: item.selected ? "#f87171" : "#4ade80", fontSize: "14px", fontWeight: 800, transition: "color 0.2s" }}>
                                ₹{Number(item.amount).toLocaleString('en-IN')}
                              </div>
                            </div>
                          ))}
                          {transactionItems.filter(i => i.isExisting).length === 0 && (
                            <p style={{color: "#f87171", fontSize: 12, padding: "12px", background: "rgba(248,113,113,0.1)", borderRadius: "8px", border: "1px dashed rgba(248,113,113,0.3)"}}>
                              No active SIPs found in this client's profile.
                            </p>
                          )}
                        </>
                      ) : (
                        // --- SIP REGISTRATION & NORMAL UI ---
                        transactionItems.map((item, idx) => {
                          if (form.action === "SIP Registration" && item.isExisting) {
                            return (
                              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: "12px", border: "1px dashed rgba(255,255,255,0.15)" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <span style={{ color: "#889995", fontSize: "9px", fontWeight: 800, letterSpacing: "1px" }}>CURRENTLY ACTIVE</span>
                                  <span style={{ color: "#c8d4d0", fontSize: "13px", fontWeight: 600 }}>{item.productName}</span>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ color: "#4ade80", fontSize: "15px", fontWeight: 800 }}>₹{Number(item.amount).toLocaleString('en-IN')}</div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "8px" }}>
                              <input 
                                readOnly={!item.isEditable}
                                style={{
                                  ...iStyle, 
                                  flex: 2, 
                                  height: "42px", 
                                  opacity: item.isEditable ? 1 : 0.6,
                                  cursor: item.isEditable ? "text" : "not-allowed"
                                }} 
                                placeholder="Scheme / Product Name" 
                                value={item.productName} 
                                onChange={(e) => updateTransactionItem(idx, 'productName', e.target.value)} 
                                required={item.isEditable} 
                              />
                              
                              <div style={{ flex: 1.5, display: "flex", flexDirection: "column", gap: "4px" }}>
                                <input 
                                  readOnly={!item.isEditable}
                                  type="number" 
                                  style={{
                                    ...iStyle, 
                                    width: "100%", 
                                    height: "42px", 
                                    opacity: item.isEditable ? 1 : 0.6,
                                    cursor: item.isEditable ? "text" : "not-allowed"
                                  }} 
                                  placeholder="Amount (₹)" 
                                  value={item.amount} 
                                  onChange={(e) => updateTransactionItem(idx, 'amount', e.target.value)} 
                                  required={item.isEditable} 
                                />
                                {item.amount && !isNaN(item.amount) && parseFloat(item.amount) > 0 && (
                                  <p style={{ fontSize: 10, color: "#4ade80", fontWeight: 600, fontStyle: "italic", marginLeft: "4px" }}>
                                    {numberToWords(item.amount)}
                                  </p>
                                )}
                              </div>
                              
                              {form.action === "Lumpsum & SIP" && (
                                <select
                                  disabled={!item.isEditable}
                                  style={{ 
                                    ...iStyle, 
                                    width: "80px", 
                                    height: "42px", 
                                    padding: "0 8px", 
                                    opacity: item.isEditable ? 1 : 0.6,
                                    cursor: item.isEditable ? "pointer" : "not-allowed"
                                  }}
                                  value={item.type || "SIP"}
                                  onChange={(e) => updateTransactionItem(idx, 'type', e.target.value)}
                                >
                                  <option value="SIP">SIP</option>
                                  <option value="LS">LS</option>
                                </select>
                              )}

                              {!item.isEditable && !item.isExisting && (
                                <button 
                                  type="button" 
                                  onClick={() => updateTransactionItem(idx, 'isEditable', true)}
                                  style={{ 
                                    width: "42px", height: "42px", borderRadius: "10px", 
                                    background: "rgba(96, 165, 250, 0.1)", border: "1px solid rgba(96, 165, 250, 0.2)", 
                                    color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 
                                  }}
                                >
                                  <Pencil size={15} />
                                </button>
                              )}

                              <button 
                                type="button" 
                                onClick={() => removeTransactionItem(idx)}
                                disabled={transactionItems.length === 1}
                                style={{ 
                                  width: "42px", height: "42px", borderRadius: "10px", 
                                  background: transactionItems.length === 1 ? "rgba(255,255,255,0.02)" : "rgba(248,113,113,0.1)", 
                                  border: transactionItems.length === 1 ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(248,113,113,0.2)", 
                                  color: transactionItems.length === 1 ? "rgba(255,255,255,0.2)" : "#f87171", 
                                  display: "flex", alignItems: "center", justifyContent: "center", cursor: transactionItems.length === 1 ? "not-allowed" : "pointer", flexShrink: 0 
                                }}
                              >
                                <X size={16} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Don't show "Add Row" button if we are doing a cancellation */}
                    {form.action !== "SIP Cancellation" && (
                      <button 
                        type="button" 
                        onClick={addTransactionItem}
                        style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", color: "#4ade80", border: "none", fontSize: "12px", fontWeight: 700, cursor: "pointer", marginTop: "12px", padding: 0 }}
                      >
                        <Plus size={14} /> {form.action === "SIP Registration" ? "Add New SIP" : "Add Another Investment"}
                      </button>
                    )}

                    {totalTransactionAmount > 0 && (
                      <div style={{ marginTop: "16px", padding: "12px", background: form.action === "SIP Cancellation" ? "rgba(248,113,113,0.1)" : "rgba(0,130,84,0.1)", border: form.action === "SIP Cancellation" ? "1px solid rgba(248,113,113,0.2)" : "1px solid rgba(0,130,84,0.2)", borderRadius: "10px" }}>
                        <p style={{ fontSize: 11, color: "#889995", textTransform: "uppercase", fontWeight: 700, marginBottom: 2 }}>
                          {form.action === "SIP Registration" ? "New SIP Total" : form.action === "SIP Cancellation" ? "Total Value to Cancel" : "Grand Total"}
                        </p>
                        <p style={{ fontSize: 16, color: form.action === "SIP Cancellation" ? "#f87171" : "white", fontWeight: 700 }}>₹{totalTransactionAmount.toLocaleString('en-IN')}</p>
                        <p style={{ fontSize: 11, color: form.action === "SIP Cancellation" ? "#f87171" : "#4ade80", marginTop: 4, fontWeight: 600, fontStyle: "italic" }}>
                          {numberToWords(totalTransactionAmount)}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
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
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <input type="number" style={iStyle} placeholder="Optional" value={form.amount} onChange={e => set("amount", e.target.value)} />
                        {form.amount && (
                          <p style={{ fontSize: 11, color: "#4ade80", fontWeight: 600, fontStyle: "italic", marginLeft: "4px" }}>
                            {numberToWords(form.amount)}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
                <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Notes</label><textarea rows={3} style={iStyle} value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
              </div>
            </div>

            {/* Assignment */}
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
              <button 
                type="submit" 
                disabled={saving || (form.action === "SIP Cancellation" && transactionItems.filter(i => i.selected).length === 0)} 
                style={{ 
                  padding: "11px 32px", borderRadius: 12, 
                  background: form.action === "SIP Cancellation" ? "#dc2626" : "#008254", 
                  color: "white", border: "none", fontWeight: 700, 
                  cursor: (saving || (form.action === "SIP Cancellation" && transactionItems.filter(i => i.selected).length === 0)) ? "not-allowed" : "pointer",
                  opacity: (saving || (form.action === "SIP Cancellation" && transactionItems.filter(i => i.selected).length === 0)) ? 0.5 : 1
                }}
              >
                {saving ? "Creating..." : form.action === "SIP Cancellation" ? "Create Cancellation Task" : "Create Task"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}