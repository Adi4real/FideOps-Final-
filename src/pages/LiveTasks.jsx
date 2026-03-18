import { useState, useEffect } from "react";
import { format, isToday, isPast, parseISO, differenceInDays } from "date-fns";
import { AlertTriangle, Clock, CalendarCheck, Search, RefreshCw, Pencil, Check, X, CalendarPlus, Download, Plus } from "lucide-react";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, orderBy, doc, updateDoc, deleteDoc, getDocs, where } from "firebase/firestore";

// --- Branch Mapping Logic ---
function getBranch(rm) {
  if (!rm) return "";
  if (rm === "Ujjwal and Joel") return "Katni Branch";
  if (rm.includes("Ujjwal") || rm.includes("Manny")) return "Chennai Branch";
  if (rm.includes("Uday") || rm.includes("Joel") || rm.includes("Prince")) return "Katni Branch";
  return rm;
}

// --- Helper: Convert Number to Indian Words ---
function numberToWords(num) {
  if (num === 0 || !num || isNaN(num)) return "";
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


// Configuration Constants
const ACTION_OPTIONS = [
  "Account Opening", "Demat Transfer", "KYC Update", "Advisory", "General Follow-up",
  "SIP Registration", "SIP Cancellation", "Redemption", "Lumpsum Purchase", 
  "Lumpsum & SIP", "Switch", "NFO Purchase", "Account Statement", 
  "Capital Gains Statement", "Nomination Update", "Bank Mandate", "Other",
  "KYC Verification", "KYC Modification", "Physical KYC", "eKYC", "SIP Switch", 
  "SIP Stop", "SIP Top-up", "SIP Restart", "SIP Pause", "Scheme Switch", 
  "Scheme Redemption", "Scheme Re-investment", "New Policy Purchase", 
  "Policy Renewal", "Policy Servicing", "Policy Surrender", "Policy Claim Assistance", 
  "Policy Revival", "Policy Nominee Update", "Policy Detail Update / Correction"
];

const STAFF_MEMBERS = ["Ujjwal", "Manny", "Uday", "Joel", "Prince", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel"];
const CHANNEL_OPTIONS = ["Email", "WhatsApp", "Call", "In-Person", "Branch Visit"];
const ALL_STATUSES = ["Pending", "Under Process", "Waiting Client", "Completed", "Cancelled"];
const ACTIVE_STATUSES = ["Pending", "Under Process", "Waiting Client"];

const ROW_BG = {
  "Pending": "rgba(248,113,113,0.10)",
  "Under Process": "rgba(251,191,36,0.09)",
  "Waiting Client": "rgba(96,165,250,0.09)",
  "Completed": "rgba(74,222,128,0.08)",
  "Cancelled": "rgba(100,116,139,0.07)",
};

const STATUS_STYLE = {
  "Pending": { bg: "rgba(248,113,113,0.15)", text: "#f87171", border: "rgba(248,113,113,0.3)" },
  "Under Process": { bg: "rgba(251,191,36,0.15)", text: "#fbbf24", border: "rgba(251,191,36,0.3)" },
  "Waiting Client": { bg: "rgba(96,165,250,0.15)", text: "#60a5fa", border: "rgba(96,165,250,0.3)" },
  "Completed": { bg: "rgba(74,222,128,0.15)", text: "#4ade80", border: "rgba(74,222,128,0.3)" },
  "Cancelled": { bg: "rgba(100,116,139,0.12)", text: "#64748b", border: "rgba(100,116,139,0.2)" },
};

const PRIORITY_STYLE = {
  "High": { bg: "rgba(248,113,113,0.15)", text: "#f87171" },
  "Medium": { bg: "rgba(251,191,36,0.15)", text: "#fbbf24" },
  "Low": { bg: "rgba(74,222,128,0.15)", text: "#4ade80" },
};

const GROUP_STYLE = {
  "Overdue": { headerBg: "rgba(248,113,113,0.1)", headerText: "#f87171", icon: AlertTriangle },
  "Today": { headerBg: "rgba(251,191,36,0.1)", headerText: "#fbbf24", icon: Clock },
  "Upcoming": { headerBg: "rgba(74,222,128,0.1)", headerText: "#4ade80", icon: CalendarCheck },
};

function makeGCalLink(task) {
  const date = task.follow_up_date ? task.follow_up_date.replace(/-/g, "") : format(new Date(), "yyyyMMdd");
  const start = `${date}T090000`;
  const end = `${date}T100000`;
  const title = encodeURIComponent(`[${task.task_id}] ${task.client_name} — ${task.action}`);
  const details = encodeURIComponent(
    `Task ID: ${task.task_id}\nClient: ${task.client_name} (${task.client_code || ""})\nCategory: ${task.category}\nAction: ${task.action}\nAssigned To: ${task.assigned_to}\nBranch: ${task.branch || ""}\nStatus: ${task.status}${task.notes ? `\nNotes: ${task.notes}` : ""}`
  );
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
}

function exportToExcel(allTasks, selectedYear) {
  const filteredForExport = selectedYear === "All" ? allTasks : allTasks.filter(t => t.financial_year === selectedYear);
  const headers = ["Task ID", "Financial Year", "Entry Date", "Client Code", "Client Name", "RM Assigned", "Branch", "Category", "Action", "Product Name", "Amount", "Priority", "Assigned To", "Follow-up Date", "Channel", "Status", "Closure Date", "Ageing (days)", "Notes", "Reviewer Notes"];
  const rows = filteredForExport.map(t => {
    let ageing = 0;
    if (t.status === "Completed" && t.closure_date && t.entry_date) ageing = differenceInDays(parseISO(t.closure_date), parseISO(t.entry_date));
    else if (t.entry_date) ageing = differenceInDays(new Date(), parseISO(t.entry_date));
    return [
      t.task_id, t.financial_year, t.entry_date, t.client_code, t.client_name,
      t.rm_assigned, t.branch, t.category, t.action, t.product_name,
      t.amount || "", t.priority, t.assigned_to, t.follow_up_date,
      t.channel, t.status, t.closure_date || "", ageing,
      (t.notes || "").replace(/"/g, '""'), (t.reviewer_notes || "").replace(/"/g, '""')
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `FideloOps_Tasks_${selectedYear}_${format(new Date(), "dd-MM-yyyy")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// --- Helper: Parse the structured text string back into Objects for Editing ---
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


function EditableRow({ task, onStatusChange, onNotesUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...task });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reviewNote, setReviewNote] = useState(task.reviewer_notes || "");

  const isTransactionFormat = task.category === "Transaction" || (task.product_name && task.product_name.includes("(₹"));
  
  const [transactionItems, setTransactionItems] = useState(parseTransactionItems(task.product_name));
  const [productTags, setProductTags] = useState(!isTransactionFormat && task.product_name ? task.product_name.split("\n").filter(t => t.trim() !== "") : []);

  const st = STATUS_STYLE[task.status] || STATUS_STYLE["Pending"];
  const pr = PRIORITY_STYLE[task.priority] || PRIORITY_STYLE["Medium"];
  const rowBg = ROW_BG[task.status] || "transparent";

  // Normal Tags Logic
  const [productInput, setProductInput] = useState("");
  const addTag = () => {
    const val = productInput.trim();
    if (val && !productTags.includes(val)) {
      setProductTags([...productTags, val]);
      setProductInput("");
    }
  };
  const removeTag = (tagToRemove) => setProductTags(productTags.filter(t => t !== tagToRemove));
  const handleProductKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
  };

  // Transaction Items Logic
  const addTransactionItem = () => setTransactionItems([...transactionItems, { productName: "", amount: "", type: "SIP" }]);
  const updateTransactionItem = (index, field, value) => {
    const newItems = [...transactionItems];
    newItems[index][field] = value;
    setTransactionItems(newItems);
  };
  const removeTransactionItem = (index) => setTransactionItems(transactionItems.filter((_, i) => i !== index));
  const totalTransactionAmount = transactionItems.reduce((sum, item) => {
    const val = parseFloat(item.amount);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);


  const handleSave = async (e) => {
    e.stopPropagation();
    setSaving(true);
    
    let finalProductString = "";
    let finalAmount = null;

    if (isTransactionFormat || editForm.category === "Transaction") {
      const validItems = transactionItems.filter(i => i.productName.trim() || i.amount);
      finalProductString = validItems.map(i => {
        let str = `${i.productName} (₹${i.amount || 0})`;
        if (editForm.action === "Lumpsum & SIP") str += ` [${i.type || 'SIP'}]`;
        return str;
      }).join("\n");
      finalAmount = totalTransactionAmount > 0 ? totalTransactionAmount : null;
    } else {
      finalProductString = productTags.join("\n");
      finalAmount = editForm.amount ? parseFloat(editForm.amount) : null;
    }

    const update = { ...editForm, product_name: finalProductString, amount: finalAmount };
    
    if (editForm.status === "Completed" && task.status !== "Completed") {
      update.closure_date = format(new Date(), "yyyy-MM-dd");
    }
    
    const taskRef = doc(db, "tasks", task.id);
    await updateDoc(taskRef, update);
    setSaving(false);
    setEditing(false);
    onStatusChange(task.id, update.status, update); 
  };

  const handleRowClick = (e) => {
    const tag = e.target.tagName.toLowerCase();
    if (["button", "input", "select", "a", "textarea", "svg", "path"].includes(tag)) return;
    if (!editing) setExpanded(!expanded);
  };

  const cellStyle = { padding: "11px 12px", verticalAlign: "middle" };
  const inputStyle = { padding: "6px 10px", borderRadius: 6, background: "#0a1612", border: "1px solid rgba(255,255,255,0.15)", color: "#c8d4d0", fontSize: 12, width: "100%" };

  return (
    <>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
      `}</style>
      
      <tr onClick={handleRowClick} style={{ background: rowBg, borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "filter 0.15s", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.25)"} onMouseLeave={e => e.currentTarget.style.filter = "brightness(1)"}>
        <td style={cellStyle}><span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#008254" }}>{task.task_id}</span></td>
        <td style={cellStyle}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#c8d4d0" }}>{task.client_name}</div>
          {task.client_code && <div style={{ fontSize: 11, color: "#889995" }}>{task.client_code}</div>}
        </td>
        <td style={cellStyle}>
          {editing ? (
            <select value={editForm.action} onChange={e => setEditForm(f => ({ ...f, action: e.target.value }))} style={inputStyle}>
              {ACTION_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : (
            <div><div style={{ fontSize: 13, color: "#c8d4d0", fontWeight: 400 }}>{task.action}</div><div style={{ fontSize: 11, color: "#889995" }}>{task.category}</div></div>
          )}
        </td>
        <td style={cellStyle}>
          {editing ? (
            <select value={editForm.assigned_to} onChange={e => { const val = e.target.value; setEditForm(f => ({ ...f, assigned_to: val, branch: getBranch(val) })); }} style={inputStyle}>
              {STAFF_MEMBERS.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: "#c8d4d0", fontWeight: 400 }}>{task.assigned_to}</span>
          )}
        </td>
        <td style={cellStyle}>
          {editing ? (
            <input type="date" value={editForm.follow_up_date || ""} onChange={e => setEditForm(f => ({ ...f, follow_up_date: e.target.value }))} style={inputStyle} />
          ) : (
            <span style={{ fontSize: 12, color: "#889995", fontWeight: 400 }}>{task.follow_up_date ? format(parseISO(task.follow_up_date), "dd MMM yy") : "—"}</span>
          )}
        </td>
        <td style={cellStyle}><span style={{ padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 400, background: pr.bg, color: pr.text }}>{task.priority || "—"}</span></td>
        <td style={cellStyle}>
          <select value={editing ? editForm.status : task.status} onChange={e => { if (editing) setEditForm(f => ({ ...f, status: e.target.value })); else onStatusChange(task.id, e.target.value, task); }} style={{ padding: "4px 8px", borderRadius: 8, fontSize: 11, fontWeight: 400, background: st.bg, border: `1px solid ${st.border}`, color: st.text, cursor: "pointer" }}>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <td style={cellStyle}>
          {(() => {
            let days = 0;
            if (task.status === "Completed" && task.closure_date && task.entry_date) days = differenceInDays(parseISO(task.closure_date), parseISO(task.entry_date));
            else if (task.entry_date) days = differenceInDays(new Date(), parseISO(task.entry_date));
            const color = days > 14 ? "#f87171" : days > 7 ? "#fbbf24" : "#889995";
            return <span style={{ fontSize: 12, color, fontWeight: 400 }}>{days}d</span>;
          })()}
        </td>
        <td style={{ ...cellStyle, textAlign: "right" }}>
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
            {editing ? (
              <><button onClick={handleSave} disabled={saving} style={{ padding: 5, borderRadius: 6, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80", cursor: "pointer" }}><Check className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); setEditing(false); setEditForm({ ...task }); setTransactionItems(parseTransactionItems(task.product_name)); }} style={{ padding: 5, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", cursor: "pointer" }}><X className="w-3.5 h-3.5" /></button></>
            ) : (
              <><a href={makeGCalLink(task)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ padding: 5, borderRadius: 6, background: "rgba(66,133,244,0.1)", border: "1px solid rgba(66,133,244,0.25)", color: "#60a5fa", cursor: "pointer", display: "inline-flex", alignItems: "center" }} title="Add to Google Calendar"><CalendarPlus className="w-3.5 h-3.5" /></a>
                <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} style={{ padding: 5, borderRadius: 6, background: "rgba(0,130,84,0.1)", border: "1px solid rgba(0,130,84,0.2)", color: "#4ade80", cursor: "pointer" }} title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this task?")) onDelete(task.id); }} style={{ padding: 5, borderRadius: 6, background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.15)", color: "#f87171", cursor: "pointer" }} title="Delete"><X className="w-3.5 h-3.5" /></button></>
            )}
          </div>
        </td>
      </tr>
      
      {expanded && (
        <tr style={{ background: rowBg, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <td colSpan={9} style={{ padding: "16px 16px 20px 48px" }}>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", fontSize: 12, color: "#889995", marginBottom: 20 }}>
              <div style={{display: "flex", flexDirection: "column", gap: 4}}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase" }}>Branch</span> 
                <span style={{ color: editing ? "#4ade80" : "inherit", fontWeight: editing ? 600 : 400 }}>{editing ? editForm.branch : (task.branch || "—")}</span>
              </div>
              <div style={{display: "flex", flexDirection: "column", gap: 4}}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase" }}>Channel</span> 
                {editing ? (<select value={editForm.channel || ""} onChange={e => setEditForm(f => ({ ...f, channel: e.target.value }))} style={{ ...inputStyle, padding: "2px 6px" }}>{CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>) : (task.channel || "—")}
              </div>
              
              {!isTransactionFormat && (
                <div style={{display: "flex", flexDirection: "column", gap: 4}}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase" }}>Amount</span> 
                  {editing ? (<input type="number" value={editForm.amount || ""} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={{ ...inputStyle, width: 100, padding: "2px 6px" }} />) : `₹${(task.amount || 0).toLocaleString("en-IN")}`}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 24 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase", marginBottom: 8 }}>
                {isTransactionFormat ? "Transaction Details" : "Products"}
              </span>
              
              {editing ? (
                isTransactionFormat ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "600px" }}>
                    {transactionItems.map((item, idx) => (
                      <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                        <input 
                          style={{...inputStyle, flex: 2, height: "36px"}} 
                          placeholder="Scheme / Product Name" 
                          value={item.productName} 
                          onChange={(e) => updateTransactionItem(idx, 'productName', e.target.value)} 
                          required 
                        />
                        <div style={{ flex: 1.5, display: "flex", flexDirection: "column", gap: "4px" }}>
                          <input 
                            type="number" 
                            style={{...inputStyle, width: "100%", height: "36px"}} 
                            placeholder="Amount (₹)" 
                            value={item.amount} 
                            onChange={(e) => updateTransactionItem(idx, 'amount', e.target.value)} 
                            required 
                          />
                          {item.amount && !isNaN(item.amount) && parseFloat(item.amount) > 0 && (
                            <p style={{ fontSize: 9, color: "#4ade80", fontWeight: 600, fontStyle: "italic", marginLeft: "4px" }}>
                              {numberToWords(item.amount)}
                            </p>
                          )}
                        </div>

                        {editForm.action === "Lumpsum & SIP" && (
                          <select
                            style={{ ...inputStyle, width: "70px", height: "36px", padding: "0 6px" }}
                            value={item.type || "SIP"}
                            onChange={(e) => updateTransactionItem(idx, 'type', e.target.value)}
                          >
                            <option value="SIP">SIP</option>
                            <option value="LS">LS</option>
                          </select>
                        )}

                        <button 
                          type="button" 
                          onClick={() => removeTransactionItem(idx)}
                          disabled={transactionItems.length === 1}
                          style={{ 
                            width: "36px", height: "36px", borderRadius: "8px", 
                            background: transactionItems.length === 1 ? "rgba(255,255,255,0.02)" : "rgba(248,113,113,0.1)", 
                            border: transactionItems.length === 1 ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(248,113,113,0.2)", 
                            color: transactionItems.length === 1 ? "rgba(255,255,255,0.2)" : "#f87171", 
                            display: "flex", alignItems: "center", justifyContent: "center", cursor: transactionItems.length === 1 ? "not-allowed" : "pointer", flexShrink: 0 
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                      <button 
                        type="button" 
                        onClick={addTransactionItem}
                        style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", color: "#4ade80", border: "none", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}
                      >
                        <Plus size={12} /> Add Row
                      </button>

                      {totalTransactionAmount > 0 && (
                         <div style={{ textAlign: "right" }}>
                           <p style={{ fontSize: 12, color: "white", fontWeight: 700 }}>Total: ₹{totalTransactionAmount.toLocaleString('en-IN')}</p>
                         </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <input style={{ ...inputStyle, marginBottom: 8, maxWidth: "400px" }} placeholder="Add product (comma or Enter)..." value={productInput} onChange={e => setProductInput(e.target.value)} onKeyDown={handleProductKeyDown} onBlur={addTag} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {productTags.map((tag, idx) => (<div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,130,84,0.15)", border: "1px solid rgba(0,130,84,0.3)", padding: "2px 8px", borderRadius: 6, color: "#4ade80", fontSize: 11 }}>{tag}<X size={12} style={{ cursor: "pointer", color: "#f87171" }} onClick={() => removeTag(tag)} /></div>))}
                    </div>
                  </div>
                )
              ) : (
                isTransactionFormat ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {parseTransactionItems(task.product_name).map((item, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.03)", padding: "6px 12px", borderRadius: 6, width: "fit-content" }}>
                         <span style={{ color: "#c8d4d0", fontSize: 12 }}>{item.productName}</span>
                         {item.amount && <span style={{ color: "#4ade80", fontSize: 12, fontWeight: "bold" }}>₹{Number(item.amount).toLocaleString('en-IN')}</span>}
                         
                         {/* Show SIP or Lumpsum Badge if it was saved during Lumpsum & SIP */}
                         {task.action === "Lumpsum & SIP" && item.type && (
                           <span style={{ background: "rgba(255,255,255,0.1)", padding: "2px 6px", borderRadius: 4, fontSize: 10, color: "#fff", fontWeight: 600 }}>{item.type}</span>
                         )}
                      </div>
                    ))}
                    {task.amount && (
                      <div style={{ marginTop: 8, color: "white", fontSize: 13, fontWeight: "bold" }}>
                        Grand Total: ₹{task.amount.toLocaleString('en-IN')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {productTags.length > 0 ? productTags.map((tag, idx) => (<span key={idx} style={{ background: "rgba(255,255,255,0.05)", padding: "4px 10px", borderRadius: 6, color: "#c8d4d0", fontSize: 11 }}>{tag}</span>)) : "—"}
                  </div>
                )
              )}
            </div>

            {task.notes && <div style={{ fontSize: 12, color: "#889995", marginBottom: 12, fontStyle: "italic", borderLeft: "2px solid rgba(255,255,255,0.1)", paddingLeft: 10 }}>"{task.notes}"</div>}
            
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: "600px" }}>
              <div style={{flex: 1}}>
                <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase", marginBottom: 6 }}>Reviewer Notes</span>
                <textarea rows={2} value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add internal reviewer notes..." style={{ width: "100%", padding: "8px 12px", borderRadius: 8, background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 12, resize: "none" }} />
              </div>
              <button onClick={() => onNotesUpdate(task.id, reviewNote)} style={{ padding: "8px 16px", borderRadius: 8, background: "#008254", color: "white", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", height: "fit-content", marginBottom: "4px" }}>Save Notes</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function LiveTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterAssigned, setFilterAssigned] = useState("all");
  const [filterUrgency, setFilterUrgency] = useState("all");
  const [exportYear, setExportYear] = useState("2025-26");
  const [refreshing, setRefreshing] = useState(false);

  const fetchTasks = () => {
    setRefreshing(true);
    const q = query(collection(db, "tasks"), orderBy("follow_up_date", "asc"));
    return onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
      setRefreshing(false);
    });
  };

  useEffect(() => {
    const unsubscribe = fetchTasks();
    return () => unsubscribe();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    const qs = await getDocs(collection(db, "tasks"));
    setTasks(qs.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    setTimeout(() => setRefreshing(false), 500);
  };

  // --- NEW LOGIC: Handling Auto-Deletion of Cancelled SIPs in Client Master ---
  const handleTaskStatusUpdate = async (taskId, newStatus, fullTaskData) => {
    if (!taskId) return;
    
    const update = { status: newStatus };
    if (newStatus === "Completed") {
      update.closure_date = format(new Date(), "yyyy-MM-dd");
    }
    
    // Update the Task Document
    await updateDoc(doc(db, "tasks", taskId), update);

    // If the task is a Completed SIP Cancellation, remove those SIPs from the Client Master
    if (newStatus === "Completed" && fullTaskData && fullTaskData.action === "SIP Cancellation" && fullTaskData.client_code) {
      try {
        console.log(`Processing SIP Cancellation for ${fullTaskData.client_code}...`);
        
        // 1. Get the schemes the user marked for cancellation in this task
        const cancelledSchemes = parseTransactionItems(fullTaskData.product_name).map(i => i.productName.toLowerCase().trim());
        if (cancelledSchemes.length === 0) return;

        // 2. Find the Client Document
        const clientsRef = collection(db, "clients");
        const q = query(clientsRef, where("client_code", "==", fullTaskData.client_code));
        const clientSnapshot = await getDocs(q);
        
        if (!clientSnapshot.empty) {
          const clientDoc = clientSnapshot.docs[0];
          const clientData = clientDoc.data();
          
          // 3. Find the array containing their investments (handling variations in naming)
          const targetKey = Object.keys(clientData).find(k => k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('investments') || k.toLowerCase().includes('sips'));
          
          if (targetKey && Array.isArray(clientData[targetKey])) {
            const originalPortfolio = clientData[targetKey];
            
            // 4. Filter out the cancelled schemes
            const updatedPortfolio = originalPortfolio.filter(inv => {
              const invName = (inv.scheme_name || inv.scheme || inv.productName || inv.name || "").toLowerCase().trim();
              
              // If the current investment matches one of the cancelled schemes, REMOVE it (return false)
              const isCancelled = cancelledSchemes.some(cancelledName => invName.includes(cancelledName) || cancelledName.includes(invName));
              return !isCancelled;
            });

            // 5. Update the Client Master Document if changes were made
            if (originalPortfolio.length !== updatedPortfolio.length) {
              await updateDoc(doc(db, "clients", clientDoc.id), {
                [targetKey]: updatedPortfolio
              });
              console.log(`Successfully removed cancelled SIPs from Client Master: ${fullTaskData.client_code}`);
            }
          }
        }
      } catch (error) {
        console.error("Error auto-deleting cancelled SIP from Client Master:", error);
      }
    }
  };

  const handleNotesUpdate = async (taskId, reviewer_notes) => {
    await updateDoc(doc(db, "tasks", taskId), { reviewer_notes });
  };

  const handleDelete = async (taskId) => {
    await deleteDoc(doc(db, "tasks", taskId));
  };

  const getUrgencyStatus = (task) => {
    if (!task.follow_up_date) return "upcoming";
    const d = parseISO(task.follow_up_date);
    if (isPast(d) && !isToday(d)) return "overdue";
    if (isToday(d)) return "today";
    return "upcoming";
  };

  const financialYears = ["All", ...new Set(tasks.map(t => t.financial_year).filter(Boolean))].sort().reverse();

  let filtered = tasks.filter(t => {
    if (filterStatus === "active") return ACTIVE_STATUSES.includes(t.status);
    if (filterStatus !== "all") return t.status === filterStatus;
    return true;
  });
  if (filterPriority !== "all") filtered = filtered.filter(t => t.priority === filterPriority);
  if (filterAssigned !== "all") filtered = filtered.filter(t => t.assigned_to === filterAssigned);
  if (filterUrgency !== "all") filtered = filtered.filter(t => getUrgencyStatus(t) === filterUrgency);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t => t.task_id?.toLowerCase().includes(q) || t.client_name?.toLowerCase().includes(q) || t.action?.toLowerCase().includes(q) || t.assigned_to?.toLowerCase().includes(q));
  }

  const overdue = filtered.filter(t => getUrgencyStatus(t) === "overdue");
  const today = filtered.filter(t => getUrgencyStatus(t) === "today");
  const upcoming = filtered.filter(t => getUrgencyStatus(t) === "upcoming");
  const assignees = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];

  const groups = [
    { label: "Overdue", tasks: overdue },
    { label: "Today", tasks: today },
    { label: "Upcoming", tasks: upcoming },
  ];

  const selectStyle = { padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 500, background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", cursor: "pointer" };
  const urgencyBtnStyle = (key) => ({
    padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid",
    background: filterUrgency === key ? (key === "overdue" ? "rgba(248,113,113,0.2)" : key === "today" ? "rgba(251,191,36,0.2)" : "rgba(74,222,128,0.2)") : "rgba(255,255,255,0.03)",
    color: filterUrgency === key ? (key === "overdue" ? "#f87171" : key === "today" ? "#fbbf24" : "#4ade80") : "#556660",
    borderColor: filterUrgency === key ? (key === "overdue" ? "rgba(248,113,113,0.4)" : key === "today" ? "rgba(251,191,36,0.4)" : "rgba(74,222,128,0.4)") : "rgba(255,255,255,0.07)",
  });

  return (
    <div style={{ background: "#060c0a", minHeight: "100vh", padding: "28px 24px" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#c8d4d0" }}>Live Tasks</h1>
            <p style={{ fontSize: 13, color: "#889995", marginTop: 4 }}>Daily task tracker — {filtered.length} tasks</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", background: "rgba(0,130,84,0.12)", border: "1px solid rgba(0,130,84,0.3)", borderRadius: 10, overflow: "hidden" }}>
              <select value={exportYear} onChange={(e) => setExportYear(e.target.value)} style={{ background: "transparent", border: "none", color: "#4ade80", fontSize: 11, padding: "0 8px", outline: "none", borderRight: "1px solid rgba(0,130,84,0.2)", cursor: "pointer" }}>
                {financialYears.map(fy => <option key={fy} value={fy} style={{ background: "#0a1612" }}>{fy}</option>)}
              </select>
              <button onClick={() => exportToExcel(tasks, exportYear)} style={{ padding: "8px 14px", background: "transparent", border: "none", color: "#4ade80", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
                <Download className="w-3.5 h-3.5" /> Export Excel
              </button>
            </div>
            <button onClick={handleRefresh} disabled={refreshing} style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#889995", cursor: "pointer" }}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button style={urgencyBtnStyle("all")} onClick={() => setFilterUrgency("all")}>All</button>
          <button style={urgencyBtnStyle("overdue")} onClick={() => setFilterUrgency("overdue")}>🔴 Overdue ({overdue.length})</button>
          <button style={urgencyBtnStyle("today")} onClick={() => setFilterUrgency("today")}>🟡 Today ({today.length})</button>
          <button style={urgencyBtnStyle("upcoming")} onClick={() => setFilterUrgency("upcoming")}>🟢 Upcoming ({upcoming.length})</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
          <div style={{ position: "relative", flex: "1 1 200px" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#889995" }} />
            <input style={{ ...selectStyle, paddingLeft: 30, width: "100%", fontSize: 13 }} placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select style={selectStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="active">Active Only</option>
            <option value="all">All Statuses (Inc. Completed/Cancelled)</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={selectStyle} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            <option value="all">All Priority</option>
            {["High", "Medium", "Low"].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select style={selectStyle} value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)}>
            <option value="all">All Members</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#889995" }}>Loading tasks...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {groups.map(({ label, tasks: grpTasks }) => {
              if (!grpTasks.length) return null;
              const gs = GROUP_STYLE[label];
              const Icon = gs.icon;
              return (
                <div key={label}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, background: gs.headerBg, marginBottom: 8 }}>
                    <Icon style={{ width: 15, height: 15, color: gs.headerText }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: gs.headerText }}>{label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: gs.headerText }}>{grpTasks.length}</span>
                  </div>
                  <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
                            {["Task ID", "Client", "Work", "Assigned To", "Follow-up", "Priority", "Status", "Age", "Actions"].map(h => (
                              <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#556660", whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {grpTasks.map(task => (
                            <EditableRow key={task.id} task={task} onStatusChange={handleTaskStatusUpdate} onNotesUpdate={handleNotesUpdate} onDelete={handleDelete} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}