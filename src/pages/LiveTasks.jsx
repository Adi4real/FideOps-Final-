import { useState, useEffect } from "react";
import { format, isToday, isPast, parseISO, differenceInDays } from "date-fns";
import { AlertTriangle, Clock, CalendarCheck, Search, RefreshCw, Pencil, Check, X, CalendarPlus, Download } from "lucide-react";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, orderBy, doc, updateDoc, deleteDoc, getDocs } from "firebase/firestore";

// --- Branch Mapping Logic (Ported from Lead Import) ---
function getBranch(rm) {
  if (!rm) return "";
  if (rm === "Ujjwal and Joel") return "Katni Branch";
  if (rm.includes("Ujjwal") || rm.includes("Manny")) return "Chennai Branch";
  if (rm.includes("Uday") || rm.includes("Joel") || rm.includes("Prince")) return "Katni Branch";
  return rm;
}

// Configuration Constants
const ACTION_OPTIONS = ["Account Opening", "Demat Transfer", "SIP Registration", "KYC Update", "Redemption", "Advisory", "General Follow-up"];
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

function EditableRow({ task, onStatusChange, onNotesUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...task });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reviewNote, setReviewNote] = useState(task.reviewer_notes || "");
  const [productInput, setProductInput] = useState("");
  const [productTags, setProductTags] = useState(task.product_name ? task.product_name.split("\n").filter(t => t.trim() !== "") : []);

  const st = STATUS_STYLE[task.status] || STATUS_STYLE["Pending"];
  const pr = PRIORITY_STYLE[task.priority] || PRIORITY_STYLE["Medium"];
  const rowBg = ROW_BG[task.status] || "transparent";

  const addTag = () => {
    const val = productInput.trim();
    if (val && !productTags.includes(val)) {
      setProductTags([...productTags, val]);
      setProductInput("");
    }
  };

  const removeTag = (tagToRemove) => setProductTags(productTags.filter(t => t !== tagToRemove));

  const handleProductKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    setSaving(true);
    const finalProductString = productTags.join("\n");
    const update = { ...editForm, product_name: finalProductString };
    if (editForm.status === "Completed" && task.status !== "Completed") {
      update.closure_date = format(new Date(), "yyyy-MM-dd");
    }
    const taskRef = doc(db, "tasks", task.id);
    await updateDoc(taskRef, update);
    setSaving(false);
    setEditing(false);
    onStatusChange();
  };

  const handleRowClick = (e) => {
    const tag = e.target.tagName.toLowerCase();
    if (["button", "input", "select", "a", "textarea", "svg", "path"].includes(tag)) return;
    if (!editing) setExpanded(!expanded);
  };

  const cellStyle = { padding: "11px 12px", verticalAlign: "middle" };
  const inputStyle = { padding: "4px 8px", borderRadius: 6, background: "#0a1612", border: "1px solid rgba(255,255,255,0.15)", color: "#c8d4d0", fontSize: 12, width: "100%" };

  return (
    <>
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
          <select value={editing ? editForm.status : task.status} onChange={e => { if (editing) setEditForm(f => ({ ...f, status: e.target.value })); else onStatusChange(task.id, e.target.value); }} style={{ padding: "4px 8px", borderRadius: 8, fontSize: 11, fontWeight: 400, background: st.bg, border: `1px solid ${st.border}`, color: st.text, cursor: "pointer" }}>
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
                <button onClick={(e) => { e.stopPropagation(); setEditing(false); setEditForm({ ...task }); setProductTags(task.product_name ? task.product_name.split("\n") : []); }} style={{ padding: 5, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", cursor: "pointer" }}><X className="w-3.5 h-3.5" /></button></>
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
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, color: "#889995", marginBottom: 12 }}>
              <span><span style={{ color: "#556660" }}>Branch:</span> <span style={{ color: editing ? "#4ade80" : "inherit", fontWeight: editing ? 600 : 400 }}>{editing ? editForm.branch : (task.branch || "—")}</span></span>
              <span><span style={{ color: "#556660" }}>Channel:</span> {editing ? (<select value={editForm.channel || ""} onChange={e => setEditForm(f => ({ ...f, channel: e.target.value }))} style={{ background: "#0a1612", color: "#c8d4d0", border: "1px solid rgba(255,255,255,0.1)" }}>{CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>) : (task.channel || "—")}</span>
              <span><span style={{ color: "#556660" }}>Amount:</span> {editing ? (<input type="number" value={editForm.amount || ""} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={{ background: "#0a1612", color: "#c8d4d0", border: "1px solid rgba(255,255,255,0.1)", width: 80 }} />) : `₹${(task.amount || 0).toLocaleString("en-IN")}`}</span>
            </div>
            <div style={{ marginBottom: 16 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase", marginBottom: 6 }}>Products</span>
              {editing ? (
                <div>
                  <input style={{ ...inputStyle, marginBottom: 8 }} placeholder="Add product (comma or Enter)..." value={productInput} onChange={e => setProductInput(e.target.value)} onKeyDown={handleProductKeyDown} onBlur={addTag} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {productTags.map((tag, idx) => (<div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,130,84,0.15)", border: "1px solid rgba(0,130,84,0.3)", padding: "2px 8px", borderRadius: 6, color: "#4ade80", fontSize: 11 }}>{tag}<X size={12} style={{ cursor: "pointer", color: "#f87171" }} onClick={() => removeTag(tag)} /></div>))}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{productTags.length > 0 ? productTags.map((tag, idx) => (<span key={idx} style={{ background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 6, color: "#c8d4d0", fontSize: 11 }}>{tag}</span>)) : "—"}</div>
              )}
            </div>
            {task.notes && <div style={{ fontSize: 12, color: "#889995", marginBottom: 8, fontStyle: "italic" }}>{task.notes}</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea rows={2} value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add reviewer notes..." style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 12, resize: "none" }} />
              <button onClick={() => onNotesUpdate(task.id, reviewNote)} style={{ padding: "8px 14px", borderRadius: 8, background: "#008254", color: "white", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
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

  const handleStatusChange = async (taskId, newStatus) => {
    if (!taskId) return;
    const update = { status: newStatus };
    if (newStatus === "Completed") update.closure_date = format(new Date(), "yyyy-MM-dd");
    await updateDoc(doc(db, "tasks", taskId), update);
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
                            <EditableRow key={task.id} task={task} onStatusChange={handleStatusChange} onNotesUpdate={handleNotesUpdate} onDelete={handleDelete} />
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