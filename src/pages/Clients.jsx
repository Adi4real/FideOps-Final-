import { useState, useEffect } from "react";
import { Search, Plus, Upload, ChevronRight, Pencil, Trash2, RefreshCw, Wallet, Calendar, ChevronDown, ChevronUp, Filter, XCircle, CheckSquare, Check, ListTodo, Info, Save, X, Target, Shield } from "lucide-react";

import { db } from "../firebase"; 
import { collection, query, orderBy, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, onSnapshot, writeBatch } from "firebase/firestore";

import ClientImport from "@/components/clients/ClientImport.jsx";
import ClientForm from "@/components/clients/ClientForm.jsx";
import { format, parseISO, addYears } from "date-fns";

// --- CONSTANTS ---
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
const PRIORITIES = ["High", "Medium", "Low"];
const CHANNELS = ["Call", "WhatsApp", "Email", "Meeting", "In-Person", "Branch Visit"];

// Sync Triggers
const SIP_ADD_ACTIONS = ["SIP Registration", "SIP Top-up", "SIP Restart", "Lumpsum & SIP", "Lumpsum Purchase"];

// --- DATE FORMAT HELPERS ---
const toInputDate = (dateStr) => {
  if (!dateStr || dateStr === "-") return "";
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
  } catch(e) {}
  return "";
};
const toDisplayDate = (dateStr) => {
  if (!dateStr || dateStr === "-") return "-";
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return format(d, "dd-MMM-yyyy");
  } catch(e) {}
  return dateStr;
};

// --- HELPER: Calculate Total SIP Amount (IGNORES LS) ---
const getSIPTotal = (investments) => {
  return (investments || []).reduce((sum, inv) => {
    if (inv.type === "LS" || inv.frequency_type === "One-time") return sum; 
    const amt = parseFloat(String(inv.installment_amount).replace(/,/g, ''));
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);
};

// --- HELPER: Get SIP Count (IGNORES LS) ---
const getSipCount = (investments) => {
  return (investments || []).filter(inv => inv.type !== "LS" && inv.frequency_type !== "One-time").length;
};

// --- HELPER: Calculate Goal Progress ---
const calculateGoalMath = (data) => {
  const pv = parseFloat(data.pv) || 0;
  const years = parseFloat(data.years) || 0;
  const inf = parseFloat(data.inf) / 100 || 0;
  const growth = parseFloat(data.growth) / 100 || 0;

  const goalFV = pv * Math.pow((1 + inf), years);
  const r = growth > 0 ? Math.pow((1 + growth), 1/12) - 1 : 0;
  const n = years * 12;
  const af = (n > 0 && r > 0) ? ((Math.pow(1 + r, n) - 1) / r) * (1 + r) : n;

  let totalSIP = 0, totalLS = 0;
  (data.investments || []).forEach(inv => {
    const amt = parseFloat(inv.amount) || 0;
    if (inv.type === "SIP") totalSIP += amt; else totalLS += amt;
  });

  const sipMaturity = totalSIP * af;
  const lsMaturity = totalLS * Math.pow((1 + growth), years);
  const projectedMaturity = sipMaturity + lsMaturity;
  const gap = goalFV - projectedMaturity;

  return { goalFV, projectedMaturity, gap };
};

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

function parseTransactionItems(rawString) {
  if (!rawString) return [{ productName: "", amount: "", type: "SIP" }];
  const lines = rawString.split("\n");
  const parsed = lines.map(line => {
    const match = line.match(/^(.*?)(?:\s*\(?₹?([\d.,]+)\)?)?(?:\s*\[(.*?)\])?$/);
    if (match) {
      return { 
        productName: match[1]?.replace(/\s*\($/, '').trim() || "", 
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
  const [allPolicies, setAllPolicies] = useState([]); // Global store for all insurance policies
  
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editClient, setEditClient] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [expandedInv, setExpandedInv] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedTask, setExpandedTask] = useState(null);

  const [editingInv, setEditingInv] = useState(null);
  const [invForm, setInvForm] = useState({});

  const [activeTab, setActiveTab] = useState("timeline"); 
  const [taskFilter, setTaskFilter] = useState("All");

  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ rm: "", tax: "", holding: "", sipStatus: "" });

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // --- INSURANCE INTEGRATION STATES ---
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set()); // For bulk linking
  const [insSearch, setInsSearch] = useState(""); // <-- NEW: Insurance Search state

  // --- TASK EDITING STATE ---
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editTaskForm, setEditTaskForm] = useState({});
  const [editTxItems, setEditTxItems] = useState([]);
  const [editProductTags, setEditProductTags] = useState([]);
  const [editProductInput, setEditProductInput] = useState("");
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);

  // --- INLINE EDIT STATE FOR INFO/ACTION ---
  const [inlineEdit, setInlineEdit] = useState({ field: null, value: "", loading: false });

  // REAL-TIME ONSNAPSHOT LISTENERS (Clients, Tasks, and Policies)
  useEffect(() => {
    setLoading(true);
    const unsubClients = onSnapshot(query(collection(db, "clients"), orderBy("client_name")), (snap) => {
      const fetched = snap.docs.map(d => ({id: d.id, ...d.data()}));
      setClients(fetched);
      setSelected(prev => fetched.find(c => c.id === prev?.id) || null);
      setLoading(false);
    });

    const unsubTasks = onSnapshot(query(collection(db, "tasks"), orderBy("entry_date", "desc")), (snap) => {
      setTasks(snap.docs.map(d => ({id: d.id, ...d.data()})));
    });

    const unsubPolicies = onSnapshot(collection(db, "insurance_policies"), (snap) => {
      setAllPolicies(snap.docs.map(d => ({ docId: d.id, ...d.data() })));
    });

    return () => { unsubClients(); unsubTasks(); unsubPolicies(); };
  }, []);

  // Clear selections and searches when switching clients
  useEffect(() => {
    setSelectedSuggestions(new Set());
    setInsSearch("");
  }, [selected]);

  // --- FUZZY MATCHING & SEARCHING FOR INSURANCE ---
  const clientPolicies = selected ? allPolicies.filter(p => p.linkedClientId === selected.id) : [];
  
  const displaySuggestedPolicies = selected ? allPolicies.filter(p => {
    if (p.linkedClientId) return false; // Must be unlinked

    if (insSearch.trim().length > 0) {
      // Manual Search Mode
      const q = insSearch.toLowerCase();
      return (
        p.policyHolder?.toLowerCase().includes(q) ||
        p.policyNo?.toLowerCase().includes(q) ||
        p.plan?.toLowerCase().includes(q)
      );
    } else {
      // Auto-Fuzzy Match Mode
      const cName = String(selected.client_name || "").toLowerCase().trim();
      const pName = String(p.policyHolder || "").toLowerCase().trim();

      if (!cName || !pName) return false;
      if (cName === pName) return true;

      const cParts = cName.split(/[\s,.-]+/).filter(x => x.length > 2); 
      const pParts = pName.split(/[\s,.-]+/).filter(x => x.length > 2);

      return cParts.some(cp => pParts.includes(cp));
    }
  }) : [];

  // Logic for Insurance "Select All"
  const isAllInsSelected = displaySuggestedPolicies.length > 0 && displaySuggestedPolicies.every(p => selectedSuggestions.has(p.docId));
  const toggleSelectAllIns = () => {
    const newSet = new Set(selectedSuggestions);
    if (isAllInsSelected) {
      displaySuggestedPolicies.forEach(p => newSet.delete(p.docId));
    } else {
      displaySuggestedPolicies.forEach(p => newSet.add(p.docId));
    }
    setSelectedSuggestions(newSet);
  };


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

    const sipTotal = getSIPTotal(c.investments);
    const matchesSipStatus = filters.sipStatus === "" || 
      (filters.sipStatus === "SIP" && sipTotal > 0) || 
      (filters.sipStatus === "Non-SIP" && sipTotal === 0);

    return matchesSearch && matchesRM && matchesHolding && matchesTax && matchesSipStatus;
  });

  const groupedClients = Object.values(filtered.reduce((acc, c) => {
    const key = c.client_name?.trim().toLowerCase() || "unknown";
    if (!acc[key]) acc[key] = { client_name: c.client_name || "Unknown", profiles: [] };
    acc[key].profiles.push(c);
    return acc;
  }, {})).sort((a, b) => a.client_name.localeCompare(b.client_name));

  const activeFilterCount = Object.values(filters).filter(v => v !== "").length;
  
  const clientTasksRaw = selected ? tasks.filter(t => t.client_code === selected.client_code || t.client_name === selected.client_name) : [];
  const clientTasks = clientTasksRaw.filter(t => taskFilter === "All" || t.status === taskFilter);

  const toggleBulkMode = () => { setIsBulkMode(!isBulkMode); setSelectedIds(new Set()); };
  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
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
      for (const id of selectedIds) { await deleteDoc(doc(db, "clients", id)); }
      setSelectedIds(new Set()); setIsBulkMode(false);
      if (selected && selectedIds.has(selected.id)) setSelected(null);
    } catch (error) { console.error("Error deleting clients:", error); }
  };

  const handleDelete = async (client) => {
    if (!window.confirm(`Delete "${client.client_name}" permanently?`)) return;
    try { 
      await deleteDoc(doc(db, "clients", client.id)); 
      if (selected?.id === client.id) setSelected(null); 
    } catch (error) { console.error("Error deleting client:", error); }
  };

  const handleDeleteTask = async (taskId, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    try { 
      await deleteDoc(doc(db, "tasks", taskId)); 
    } catch (error) { console.error("Error deleting task:", error); }
  };

  const handleSave = async (data) => {
    try {
      if (data.id) { 
        await updateDoc(doc(db, "clients", data.id), data); 
      } else {
        const tax = data.tax_status || "-";
        const exists = clients.some(c => c.client_code === data.client_code && (c.tax_status || "-") === tax);
        if (exists) { alert("A client profile with this Code and Tax Status already exists!"); return; }
        await addDoc(collection(db, "clients"), { ...data, created_at: serverTimestamp() });
      }
      setShowForm(false); setEditClient(null);
    } catch (error) { console.error("Error saving client:", error); }
  };

  const handleInlineSave = async () => {
    if (!selected || !inlineEdit.field) return;
    setInlineEdit({ ...inlineEdit, loading: true });
    try {
      await updateDoc(doc(db, "clients", selected.id), { [inlineEdit.field]: inlineEdit.value });
      setInlineEdit({ field: null, value: "", loading: false });
    } catch (error) {
      console.error("Error inline saving:", error);
      setInlineEdit({ ...inlineEdit, loading: false });
    }
  };

  // --- INSURANCE ACTIONS ---
  const handleLinkSinglePolicy = async (policyDocId) => {
    try {
      await updateDoc(doc(db, "insurance_policies", policyDocId), {
        linkedClientId: selected.id,
        linkedClientName: selected.client_name
      });
      const newSet = new Set(selectedSuggestions);
      newSet.delete(policyDocId);
      setSelectedSuggestions(newSet);
    } catch (err) {
      console.error("Error linking policy:", err);
      alert("Failed to link policy.");
    }
  };

  const handleBulkLinkPolicies = async () => {
    if (selectedSuggestions.size === 0) return;
    try {
      const batch = writeBatch(db);
      selectedSuggestions.forEach(docId => {
        batch.update(doc(db, "insurance_policies", docId), {
          linkedClientId: selected.id,
          linkedClientName: selected.client_name
        });
      });
      await batch.commit();
      setSelectedSuggestions(new Set());
    } catch (err) {
      console.error("Error bulk linking policies:", err);
      alert("Failed to link policies.");
    }
  };

  const handleUnlinkPolicy = async (policyDocId) => {
    if (!window.confirm("Are you sure you want to unlink this policy from this client?")) return;
    try {
      await updateDoc(doc(db, "insurance_policies", policyDocId), {
        linkedClientId: null,
        linkedClientName: null
      });
    } catch (err) {
      console.error("Error unlinking policy:", err);
    }
  };

  const toggleSuggestionSelection = (docId) => {
    const newSet = new Set(selectedSuggestions);
    if (newSet.has(docId)) newSet.delete(docId); else newSet.add(docId);
    setSelectedSuggestions(newSet);
  };

  // --- TASK & PORTFOLIO ACTIONS ---
  const handleTaskStatusUpdate = async (taskId, newStatus, fullTaskData) => {
    try {
      const update = { status: newStatus };
      if (newStatus === "Completed") update.closure_date = format(new Date(), "yyyy-MM-dd");
      await updateDoc(doc(db, "tasks", taskId), update);

      if (newStatus === "Completed" && fullTaskData) {
        const targetClient = clients.find(c => 
          (c.client_code && c.client_code === fullTaskData.client_code) || 
          c.client_name === fullTaskData.client_name
        );
        
        if (targetClient) {
          const targetKey = Object.keys(targetClient).find(k => k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('investments') || k.toLowerCase().includes('sips')) || "investments";
          let currentPortfolio = targetClient[targetKey] || [];
          let modified = false;

          if (fullTaskData.action === "SIP Cancellation") {
            const cancelledSchemes = parseTransactionItems(fullTaskData.product_name).map(i => i.productName.toLowerCase().trim());
            if (cancelledSchemes.length > 0) {
              const updatedPortfolio = currentPortfolio.filter(inv => {
                const invName = (inv.scheme_name || inv.scheme || inv.productName || inv.name || "").toLowerCase().trim();
                return !cancelledSchemes.some(cancelledName => invName.includes(cancelledName) || cancelledName.includes(invName));
              });
              if (currentPortfolio.length !== updatedPortfolio.length) {
                currentPortfolio = updatedPortfolio;
                modified = true;
              }
            }
          } 
          else if (SIP_ADD_ACTIONS.includes(fullTaskData.action)) { 
            const newItems = parseTransactionItems(fullTaskData.product_name).filter(i => i.productName && i.amount);
            if (newItems.length > 0) {
              const addedInvestments = newItems.map(item => {
                let finalType = item.type || "SIP";
                if (fullTaskData.action === "Lumpsum Purchase") finalType = "LS";

                return {
                  scheme_name: item.productName, 
                  installment_amount: item.amount,
                  frequency_type: finalType === "LS" ? "One-time" : "Monthly",
                  folio_number: "Pending Folio", 
                  xsip_reg_no: finalType === "LS" ? "N/A" : `TEMP-${Math.floor(100000 + Math.random() * 900000)}`,
                  start_date: format(new Date(), "dd-MMM-yyyy"), 
                  end_date: "-", 
                  type: finalType
                };
              });
              
              currentPortfolio = [...currentPortfolio, ...addedInvestments];
              modified = true;

              const sipsRef = collection(db, "sips");
              for (const inv of addedInvestments) {
                await addDoc(sipsRef, {
                  ...inv,
                  client_id: targetClient.id,
                  client_code: targetClient.client_code || "N/A",
                  client_name: targetClient.client_name,
                  rm_assigned: targetClient.rm_assigned || "Unassigned",
                  branch: targetClient.branch || "Unknown",
                  status: "Active",
                  created_at: serverTimestamp()
                });
              }
            }
          }

          if (modified) {
            await updateDoc(doc(db, "clients", targetClient.id), { [targetKey]: currentPortfolio });
          }
        }
      }
    } catch (error) { console.error("Error updating task status:", error); }
  };

  const handleSaveTaskEdit = async (e) => {
    e.stopPropagation();
    setSavingTaskEdit(true);
    try {
      let finalProductString = "";
      let finalAmount = null;
      
      const isTx = editTaskForm.category === "Transaction" || SIP_ADD_ACTIONS.includes(editTaskForm.action);

      if (isTx) {
        const validItems = editTxItems.filter(i => i.productName.trim() || i.amount);
        finalProductString = validItems.map(i => {
          let str = `${i.productName} (₹${i.amount || 0})`;
          if (editTaskForm.action === "Lumpsum & SIP") str += ` [${i.type || 'SIP'}]`;
          return str;
        }).join("\n");
        const totalAmt = validItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        finalAmount = totalAmt > 0 ? totalAmt : null;
      } else {
        finalProductString = editProductTags.join("\n");
        finalAmount = editTaskForm.amount ? parseFloat(editTaskForm.amount) : null;
      }

      const updateData = { ...editTaskForm, product_name: finalProductString, amount: finalAmount };
      if (updateData.status === "Completed" && !updateData.closure_date) {
         updateData.closure_date = format(new Date(), "yyyy-MM-dd");
      }

      await updateDoc(doc(db, "tasks", editingTaskId), updateData);
      setEditingTaskId(null);
    } catch (e) { console.error("Error saving task:", e); } 
    finally { setSavingTaskEdit(false); }
  };

  const handleSaveInvestment = async (e) => {
    e.preventDefault();
    try {
      const targetKey = Object.keys(selected).find(k => k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('investments') || k.toLowerCase().includes('sips')) || "investments";
      const updatedPortfolio = [...(selected[targetKey] || [])];
      const finalFormToSave = { ...invForm };
      
      const targetIndex = finalFormToSave.originalIndex;
      delete finalFormToSave.originalIndex;
      updatedPortfolio[targetIndex] = finalFormToSave;

      await updateDoc(doc(db, "clients", selected.id), { [targetKey]: updatedPortfolio });
      setEditingInv(null); setExpandedInv(null);
    } catch (error) { console.error("Error saving investment:", error); }
  };

  const handleDeleteInvestment = async (originalIndex) => {
    if (!window.confirm("Are you sure you want to permanently delete this SIP?")) return;
    try {
      const targetKey = Object.keys(selected).find(k => k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('investments') || k.toLowerCase().includes('sips')) || "investments";
      const updatedPortfolio = [...(selected[targetKey] || [])];
      updatedPortfolio.splice(originalIndex, 1);

      await updateDoc(doc(db, "clients", selected.id), { [targetKey]: updatedPortfolio });
      setEditingInv(null); setExpandedInv(null);
    } catch (error) { console.error("Error deleting investment:", error); }
  };

  const openEdit = (client) => { setEditClient(client); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditClient(null); };

  const renderProfileButton = (c, isSubItem) => {
    const isSelectedForDeletion = selectedIds.has(c.id);
    const isActive = !isBulkMode && selected?.id === c.id;

    return (
      <button
        key={c.id}
        onClick={() => { 
          if (isBulkMode) toggleSelection(c.id);
          else { setSelected(c); setExpandedInv(null); setExpandedTask(null); setEditingTaskId(null); setActiveTab("timeline"); }
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
            
            {c.relations && c.relations.map((rel, idx) => (
              <span key={idx} className="text-[10px] text-yellow-400 font-bold ml-2 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20 truncate max-w-[120px] inline-block align-bottom">
                {rel.type} of {rel.related_to_name}
              </span>
            ))}
            
            {c.referred_by && c.referred_by !== "-" && (
              <span className="text-[10px] text-blue-400 font-bold ml-2 bg-blue-400/10 px-1.5 py-0.5 rounded border border-blue-400/20 truncate max-w-[120px] inline-block align-bottom">
                Ref. by {c.referred_by}
              </span>
            )}
            
            {!isBulkMode && !isSubItem && c.tax_status && c.tax_status !== "-" ? <span className="text-[10px] text-brand-green ml-2">({c.tax_status})</span> : ""}
          </p>
          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
            {c.client_code} · {c.branch} {!isBulkMode && getSipCount(c.investments) > 0 ? `(${getSipCount(c.investments)} SIPs)` : ""}
          </p>
        </div>
        {!isBulkMode && <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />}
      </button>
    );
  };

  const inputStyle = { padding: "6px 10px", borderRadius: 6, background: "#0a1612", border: "1px solid rgba(255,255,255,0.15)", color: "#c8d4d0", fontSize: 12, width: "100%" };

  const sipInvestmentsWithIndex = selected ? (selected.investments || [])
    .map((inv, idx) => ({ ...inv, originalIndex: idx }))
    .filter(inv => inv.type !== "LS" && inv.frequency_type !== "One-time") : [];

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh", color: "var(--text-main)" }}>
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%); cursor: pointer; }
        input[type="date"] { color-scheme: dark; color: #fbbf24 !important; font-weight: 700; }
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
      `}</style>
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>Client Master</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{clients.length} profiles / {groupedClients.length} unique names</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(v => !v)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all" style={{ background: "var(--glass)", border: "1px solid var(--brand-green)", color: "var(--brand-green)" }}>
            <Upload className="w-4 h-4" /> Import Excel
          </button>
          <button onClick={() => { setEditClient(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90" style={{ background: "var(--brand-green)", color: "white" }}>
            <Plus className="w-4 h-4" /> Add Client
          </button>
        </div>
      </div>

      {showImport && <ClientImport onImportDone={() => setShowImport(false)} onClose={() => setShowImport(false)} />}
      
      {showForm && <ClientForm client={editClient} allClients={clients} onSave={handleSave} onClose={closeForm} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
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
                style={{ background: activeFilterCount > 0 ? "rgba(0,130,84,0.15)" : "var(--input-bg)", borderColor: activeFilterCount > 0 ? "var(--brand-green)" : "var(--border)", color: activeFilterCount > 0 ? "var(--brand-green)" : "var(--text-muted)" }}
              >
                <Filter className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand-green text-white flex items-center justify-center text-[9px] font-bold shadow-sm">{activeFilterCount}</span>
                )}
              </button>

              <button 
                onClick={toggleBulkMode}
                className="relative px-3 rounded-xl border flex items-center justify-center transition-all hover:bg-white/5"
                style={{ background: isBulkMode ? "rgba(248,113,113,0.15)" : "var(--input-bg)", borderColor: isBulkMode ? "#f87171" : "var(--border)", color: isBulkMode ? "#f87171" : "var(--text-muted)" }}
                title="Select multiple clients to delete"
              >
                <CheckSquare className="w-4 h-4" />
              </button>

              {showFilters && (
                <div className="absolute top-[115%] right-0 w-64 p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-top-2" style={{ background: "#0a1612", borderColor: "var(--border)", zIndex: 100 }}>
                  <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-white">Filters</p>
                    {activeFilterCount > 0 && (
                      <button onClick={() => setFilters({rm: "", tax: "", holding: "", sipStatus: ""})} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold">
                        <XCircle className="w-3 h-3" /> Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">SIP Status</label>
                      <select value={filters.sipStatus} onChange={e => setFilters({...filters, sipStatus: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="">All Clients</option>
                        <option value="SIP">Active SIP Clients</option>
                        <option value="Non-SIP">Non-SIP Clients</option>
                      </select>
                    </div>
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
          
          <div className="overflow-y-auto flex-1 z-10 custom-scrollbar">
            {loading ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading database...</div>
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
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white" style={{ background: "var(--brand-green)" }}>
                      {selected.client_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold flex items-center flex-wrap gap-2" style={{ color: "var(--text-main)" }}>
                        {selected.client_name} 
                        <span className="text-sm text-brand-green font-mono">
                          {selected.tax_status && selected.tax_status !== "-" ? `(${selected.tax_status})` : ""}
                        </span>
                      </h2>
                      <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{selected.client_code}</p>
                      
                      {(selected.relations?.length > 0 || (selected.referred_by && selected.referred_by !== "-")) && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {selected.relations?.map((rel, idx) => (
                            <span key={idx} className="text-[10px] text-yellow-400 font-bold bg-yellow-400/10 px-2 py-0.5 rounded-md border border-yellow-400/30 tracking-wider uppercase">
                              {rel.type} of {rel.related_to_name}
                            </span>
                          ))}
                          {selected.referred_by && selected.referred_by !== "-" && (
                            <span className="text-[10px] text-blue-400 font-bold bg-blue-400/10 px-2 py-0.5 rounded-md border border-blue-400/30 tracking-wider uppercase">
                              Ref. by {selected.referred_by}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => openEdit(selected)} className="text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all" style={{ color: "var(--brand-green)", background: "rgba(0,130,84,0.1)", border: "1px solid rgba(0,130,84,0.3)" }}>
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => handleDelete(selected)} className="text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all" style={{ color: "#f87171", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)" }}>
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

                <div className="mt-4 p-3 rounded-xl text-sm relative group" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold uppercase text-[10px] text-[#889995]">Client Information</span>
                    {inlineEdit.field !== 'client_info' && (
                      <button onClick={() => setInlineEdit({ field: 'client_info', value: selected.client_info || "", loading: false })} className="opacity-0 group-hover:opacity-100 text-brand-green hover:text-white transition-all text-xs flex items-center gap-1">
                        <Pencil size={12}/> Edit
                      </button>
                    )}
                  </div>
                  {inlineEdit.field === 'client_info' ? (
                    <div className="flex items-start gap-2 mt-2">
                      <textarea 
                        className="w-full bg-black/50 border border-brand-green/30 rounded-lg p-2 text-xs text-white outline-none focus:border-brand-green min-h-[60px]" 
                        value={inlineEdit.value} 
                        onChange={e => setInlineEdit({...inlineEdit, value: e.target.value})} 
                        placeholder="Add client details here..."
                      />
                      <div className="flex flex-col gap-1">
                        <button onClick={handleInlineSave} disabled={inlineEdit.loading} className="bg-brand-green hover:bg-[#22c55e] transition-colors p-1.5 rounded text-white flex justify-center"><Check size={14}/></button>
                        <button onClick={() => setInlineEdit({field:null, value:"", loading: false})} className="bg-white/10 hover:bg-white/20 transition-colors p-1.5 rounded text-white/50 flex justify-center"><X size={14}/></button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-white/80 whitespace-pre-wrap">{selected.client_info && selected.client_info !== "-" ? selected.client_info : <span className="italic opacity-50">No client information added.</span>}</p>
                  )}
                </div>

                <div className="mt-3 p-3 rounded-xl text-sm relative group" style={{ background: "rgba(0,130,84,0.05)", border: "1px solid rgba(0,130,84,0.3)" }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold uppercase text-[10px] text-brand-green">Action Items / Next Steps</span>
                    {inlineEdit.field !== 'client_action' && (
                      <button onClick={() => setInlineEdit({ field: 'client_action', value: selected.client_action || "", loading: false })} className="opacity-0 group-hover:opacity-100 text-brand-green hover:text-white transition-all text-xs flex items-center gap-1">
                        <Pencil size={12}/> Edit
                      </button>
                    )}
                  </div>
                  {inlineEdit.field === 'client_action' ? (
                    <div className="flex items-start gap-2 mt-2">
                      <textarea 
                        className="w-full bg-black/50 border border-brand-green/30 rounded-lg p-2 text-xs text-brand-green font-medium outline-none focus:border-brand-green min-h-[60px]" 
                        value={inlineEdit.value} 
                        onChange={e => setInlineEdit({...inlineEdit, value: e.target.value})} 
                        placeholder="Write down the next action for this client..."
                      />
                      <div className="flex flex-col gap-1">
                        <button onClick={handleInlineSave} disabled={inlineEdit.loading} className="bg-brand-green hover:bg-[#22c55e] transition-colors p-1.5 rounded text-white flex justify-center"><Check size={14}/></button>
                        <button onClick={() => setInlineEdit({field:null, value:"", loading: false})} className="bg-white/10 hover:bg-white/20 transition-colors p-1.5 rounded text-white/50 flex justify-center"><X size={14}/></button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-white font-medium whitespace-pre-wrap">{selected.client_action && selected.client_action !== "-" ? selected.client_action : <span className="italic font-normal opacity-50 text-brand-green">No pending action.</span>}</p>
                  )}
                </div>

              </div>

              {/* TABS CONTAINER */}
              <div className="rounded-2xl p-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)", minHeight: "400px" }}>
                
                <div className="flex gap-6 border-b border-white/10 mb-6 overflow-x-auto custom-scrollbar whitespace-nowrap pb-1">
                  <button onClick={() => setActiveTab('timeline')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'timeline' ? 'text-brand-green border-b-2 border-brand-green' : 'text-[#889995] hover:text-white'}`}>
                    <ListTodo className="w-4 h-4" />
                    Activity Timeline ({clientTasksRaw.length})
                  </button>
                  <button onClick={() => setActiveTab('portfolio')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'portfolio' ? 'text-brand-green border-b-2 border-brand-green' : 'text-[#889995] hover:text-white'}`}>
                    <Wallet className="w-4 h-4" />
                    SIPs ({sipInvestmentsWithIndex.length})
                  </button>
                  <button onClick={() => setActiveTab('goals')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'goals' ? 'text-brand-green border-b-2 border-brand-green' : 'text-[#889995] hover:text-white'}`}>
                    <Target className="w-4 h-4" />
                    Financial Goals ({selected.financial_goals?.length || 0})
                  </button>
                  <button onClick={() => setActiveTab('insurance')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'insurance' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-[#889995] hover:text-white'}`}>
                    <Shield className="w-4 h-4" />
                    Insurance ({clientPolicies.length})
                  </button>
                </div>

                {/* TAB 1: ACTIVITY TIMELINE */}
                {activeTab === "timeline" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="flex justify-end mb-4">
                      <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} className="bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="All">All Tasks</option>
                        {["Pending","Under Process","Waiting Client","Completed","Cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {clientTasks.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995]">No tasks found matching this filter.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {clientTasks.map(t => {
                          const isCompleted = t.status === "Completed";
                          const isExpanded = expandedTask === t.id;
                          const isEditingThis = editingTaskId === t.id;
                          const isTx = t.category === "Transaction" || SIP_ADD_ACTIONS.includes(t.action) || (t.product_name && t.product_name.includes("(₹"));
                          
                          const statusColors = {
                            "Pending":        { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24", border: "rgba(251,191,36,0.25)" },
                            "Under Process":  { bg: "rgba(96,165,250,0.12)",  text: "#60a5fa", border: "rgba(96,165,250,0.25)" },
                            "Waiting Client": { bg: "rgba(167,139,250,0.12)", text: "#a78bfa", border: "rgba(167,139,250,0.25)" },
                            "Completed":      { bg: "rgba(74,222,128,0.15)",  text: "#4ade80", border: "rgba(74,222,128,0.4)" },
                            "Cancelled":      { bg: "rgba(100,116,139,0.12)", text: "#64748b", border: "rgba(100,116,139,0.2)" },
                          };
                          const sc = statusColors[t.status] || statusColors["Pending"];

                          return (
                            <div key={t.id} className={`flex flex-col gap-2 p-3 rounded-xl transition-all ${!isEditingThis ? 'cursor-pointer hover:brightness-110' : ''}`}
                              style={{ border: isExpanded || isEditingThis ? `1px solid ${sc.border}` : "1px solid var(--border)", background: isExpanded || isEditingThis ? "rgba(0,0,0,0.4)" : (isCompleted ? sc.bg : "rgba(255,255,255,0.02)")}}
                              onClick={() => { if(!isEditingThis) setExpandedTask(isExpanded ? null : t.id) }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3 min-w-0">
                                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: sc.text }} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-xs font-bold" style={{ color: isCompleted ? "#4ade80" : "var(--brand-green)" }}>{t.task_id}</span>
                                      <span className="text-xs font-medium" style={{ color: "var(--text-main)" }}>{t.action}</span>
                                      
                                      <select
                                        value={t.status}
                                        onClick={(e) => e.stopPropagation()} 
                                        onChange={(e) => handleTaskStatusUpdate(t.id, e.target.value, t)} 
                                        disabled={isEditingThis}
                                        style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: isCompleted ? "rgba(0,0,0,0.2)" : sc.bg, border: `1px solid ${sc.border}`, color: sc.text, cursor: isEditingThis ? "not-allowed" : "pointer", outline: "none", opacity: isEditingThis ? 0.5 : 1 }}
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
                                <div className="flex-shrink-0 flex items-center gap-2 pt-1">
                                  {!isEditingThis && (
                                    <>
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingTaskId(t.id);
                                        setExpandedTask(t.id);
                                        setEditTaskForm({ ...t });
                                        if (isTx) setEditTxItems(parseTransactionItems(t.product_name));
                                        else setEditProductTags(t.product_name ? t.product_name.split("\n").filter(Boolean) : []);
                                      }} className="text-[#60a5fa] hover:bg-blue-500/20 p-1.5 rounded-md transition-colors" title="Edit Task">
                                        <Pencil size={14} />
                                      </button>
                                      <button onClick={(e) => handleDeleteTask(t.id, e)} className="text-[#f87171] hover:bg-red-500/20 p-1.5 rounded-md transition-colors" title="Delete Task">
                                        <Trash2 size={14} />
                                      </button>
                                    </>
                                  )}
                                  {!isEditingThis && (isExpanded ? <ChevronUp className="w-4 h-4 text-[#889995]" /> : <ChevronDown className="w-4 h-4 text-[#889995]" />)}
                                </div>
                              </div>

                              {isExpanded && !isEditingThis && (
                                <div className="mt-3 p-4 border-t border-white/5 bg-black/40 rounded-xl animate-in slide-in-from-top-2 cursor-default" onClick={e => e.stopPropagation()}>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                                    <div><p className="text-[9px] uppercase font-bold text-[#889995] mb-1">Category</p><p className="text-xs text-white font-medium">{t.category || "—"}</p></div>
                                    <div><p className="text-[9px] uppercase font-bold text-[#889995] mb-1">Priority</p><p className="text-xs text-white font-medium">{t.priority || "—"}</p></div>
                                    <div><p className="text-[9px] uppercase font-bold text-[#889995] mb-1">Channel</p><p className="text-xs text-white font-medium">{t.channel || "—"}</p></div>
                                    <div><p className="text-[9px] uppercase font-bold text-[#889995] mb-1">Total Amount</p><p className="text-xs text-[#4ade80] font-bold">{t.amount ? `₹${t.amount.toLocaleString('en-IN')}` : "—"}</p></div>
                                  </div>

                                  <div className="mb-4">
                                    <p className="text-[9px] uppercase font-bold text-[#889995] mb-2 flex items-center gap-1"><Info size={10} /> Products & Transactions</p>
                                    <div className="flex flex-col gap-2">
                                      {isTx ? parseTransactionItems(t.product_name).map((item, idx) => (
                                        <div key={idx} className="flex items-center gap-3 bg-white/5 px-3 py-2 rounded-lg w-fit border border-white/5">
                                          <span className="text-xs text-[#c8d4d0]">{item.productName}</span>
                                          {item.amount && <span className="text-xs font-bold text-[#4ade80]">₹{Number(item.amount).toLocaleString('en-IN')}</span>}
                                          {["Lumpsum & SIP", "SIP Registration", "Lumpsum Purchase"].includes(t.action) && item.type && (
                                            <span style={{ background: item.type === "LS" ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.1)", color: item.type === "LS" ? "#60a5fa" : "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{item.type}</span>
                                          )}
                                        </div>
                                      )) : (
                                        <div className="flex flex-wrap gap-2">
                                          {t.product_name ? t.product_name.split("\n").map((tag, idx) => (<span key={idx} className="bg-white/5 px-3 py-1 rounded text-xs text-[#c8d4d0]">{tag}</span>)) : <span className="text-xs text-[#889995]">—</span>}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {t.notes && (<div className="mb-3"><p className="text-[9px] uppercase font-bold text-[#889995] mb-1">Client Notes</p><p className="text-xs text-[#889995] italic border-l-2 border-[#4ade80]/40 pl-3 py-1">"{t.notes}"</p></div>)}
                                  {t.reviewer_notes && (<div><p className="text-[9px] uppercase font-bold text-[#889995] mb-1">Internal Reviewer Notes</p><p className="text-xs text-[#f87171] bg-red-500/10 border border-red-500/20 p-2 rounded-lg">"{t.reviewer_notes}"</p></div>)}
                                </div>
                              )}

                              {isExpanded && isEditingThis && (
                                <div className="mt-3 p-4 border-t border-white/5 bg-black/60 rounded-xl cursor-default animate-in slide-in-from-top-2" onClick={e => e.stopPropagation()}>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Category</label>
                                      <select value={editTaskForm.category} onChange={e => setEditTaskForm({...editTaskForm, category: e.target.value, action: ""})} style={inputStyle}>
                                        {Object.keys(CATEGORY_ACTIONS).map(c => <option key={c} value={c}>{c}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Action</label>
                                      <select value={editTaskForm.action} onChange={e => setEditTaskForm({...editTaskForm, action: e.target.value})} style={inputStyle}>
                                        <option value="">Select...</option>
                                        {CATEGORY_ACTIONS[editTaskForm.category]?.map(a => <option key={a} value={a}>{a}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Follow-up Date</label>
                                      <input type="date" value={editTaskForm.follow_up_date || ""} onChange={e => setEditTaskForm({...editTaskForm, follow_up_date: e.target.value})} style={inputStyle} />
                                    </div>
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Priority</label>
                                      <select value={editTaskForm.priority} onChange={e => setEditTaskForm({...editTaskForm, priority: e.target.value})} style={inputStyle}>
                                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Channel</label>
                                      <select value={editTaskForm.channel} onChange={e => setEditTaskForm({...editTaskForm, channel: e.target.value})} style={inputStyle}>
                                        {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                                      </select>
                                    </div>
                                  </div>

                                  <div className="mb-4">
                                    <label className="text-[9px] uppercase font-bold text-[#889995] mb-2 block flex items-center gap-1"><Info size={10} /> Product Details</label>
                                    {isTx ? (
                                      <div className="flex flex-col gap-2">
                                        {editTxItems.map((item, idx) => (
                                          <div key={idx} className="flex gap-2 items-start">
                                            <input style={{...inputStyle, flex: 2, height: "36px"}} placeholder="Scheme Name" value={item.productName} onChange={(e) => { const n=[...editTxItems]; n[idx].productName=e.target.value; setEditTxItems(n); }} />
                                            <div className="flex flex-col gap-1 flex-[1.5]">
                                              <input type="number" style={{...inputStyle, height: "36px"}} placeholder="Amount" value={item.amount} onChange={(e) => { const n=[...editTxItems]; n[idx].amount=e.target.value; setEditTxItems(n); }} />
                                              {item.amount && !isNaN(item.amount) && parseFloat(item.amount) > 0 && <p className="text-[9px] text-[#4ade80] font-bold italic ml-1">{numberToWords(item.amount)}</p>}
                                            </div>
                                            {editTaskForm.action === "Lumpsum & SIP" && (
                                              <select style={{...inputStyle, width: "65px", height: "36px", padding: "0 4px"}} value={item.type || "SIP"} onChange={(e) => { const n=[...editTxItems]; n[idx].type=e.target.value; setEditTxItems(n); }}>
                                                <option value="SIP">SIP</option><option value="LS">LS</option>
                                              </select>
                                            )}
                                            <button onClick={() => setEditTxItems(editTxItems.filter((_, i) => i !== idx))} disabled={editTxItems.length === 1} className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 border border-red-500/20"><X size={14} /></button>
                                          </div>
                                        ))}
                                        <button onClick={() => setEditTxItems([...editTxItems, { productName: "", amount: "", type: "SIP" }])} className="flex items-center gap-1 text-xs font-bold text-[#4ade80] mt-1 w-fit hover:opacity-80"><Plus size={12} /> Add Row</button>
                                      </div>
                                    ) : (
                                      <div>
                                        <input style={{ ...inputStyle, marginBottom: 8 }} placeholder="Type comma or Enter to add" value={editProductInput} onChange={e => setEditProductInput(e.target.value)} onKeyDown={(e) => { if(e.key === "Enter" || e.key === ","){ e.preventDefault(); const v=editProductInput.trim(); if(v && !editProductTags.includes(v)) { setEditProductTags([...editProductTags, v]); setEditProductInput(""); } } }} />
                                        <div className="flex flex-wrap gap-2">
                                          {editProductTags.map((tag, idx) => (<div key={idx} className="flex items-center gap-1 bg-[#008254]/15 border border-[#008254]/30 px-2 py-1 rounded-md text-[#4ade80] text-xs font-semibold">{tag} <X size={12} className="cursor-pointer text-[#f87171]" onClick={() => setEditProductTags(editProductTags.filter(t => t !== tag))} /></div>))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Client Notes</label>
                                      <textarea value={editTaskForm.notes || ""} onChange={e => setEditTaskForm({...editTaskForm, notes: e.target.value})} rows={2} style={{...inputStyle, resize: "none"}} />
                                    </div>
                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Reviewer Notes</label>
                                      <textarea value={editTaskForm.reviewer_notes || ""} onChange={e => setEditTaskForm({...editTaskForm, reviewer_notes: e.target.value})} rows={2} style={{...inputStyle, resize: "none", borderColor: "rgba(248,113,113,0.3)"}} />
                                    </div>
                                  </div>

                                  <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                                    <button onClick={() => setEditingTaskId(null)} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-[#889995] hover:bg-white/10 transition-colors">Cancel</button>
                                    <button onClick={handleSaveTaskEdit} disabled={savingTaskEdit} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#4ade80] text-black hover:bg-[#22c55e] transition-colors disabled:opacity-50 flex items-center gap-1">
                                      <Save size={14} /> {savingTaskEdit ? "Saving..." : "Save Edits"}
                                    </button>
                                  </div>
                                </div>
                              )}

                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: INVESTMENT PORTFOLIO (SIPS ONLY) */}
                {activeTab === "portfolio" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="flex justify-end mb-4">
                      <span className="text-xs font-bold px-3 py-1.5 rounded-lg border" style={{ background: "rgba(0,130,84,0.1)", borderColor: "rgba(0,130,84,0.3)", color: "var(--brand-green)" }}>
                        Total SIPs: ₹{getSIPTotal(selected.investments).toLocaleString('en-IN')}
                      </span>
                    </div>

                    {sipInvestmentsWithIndex.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995] mb-4">No active SIPs found.</p>
                      </div>
                    ) : (
                      <div className="space-y-6 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                        {Object.entries(
                          sipInvestmentsWithIndex.reduce((acc, inv) => {
                            const folio = inv.folio_number && inv.folio_number !== "-" ? inv.folio_number : "Unassigned Folios";
                            if (!acc[folio]) acc[folio] = [];
                            acc[folio].push(inv);
                            return acc;
                          }, {})
                        ).map(([folio, invs]) => (
                          <div key={folio} className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                            <div className="mb-4">
                              <p className="text-[10px] uppercase font-bold text-[#889995] mb-1">Folio Number</p>
                              <p className="text-sm font-mono text-white tracking-wider">{folio}</p>
                            </div>
                            
                            <div className="space-y-3">
                              {invs.map((inv, idx) => {
                                const isExpanded = expandedInv === inv.originalIndex;
                                const isEditing = editingInv === inv.originalIndex;

                                return (
                                  <div key={idx} className="rounded-lg overflow-hidden transition-all" style={{ border: isExpanded ? "1px solid var(--brand-green)" : "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}>
                                    <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-white/5" onClick={() => { if(!isEditing) setExpandedInv(isExpanded ? null : inv.originalIndex) }}>
                                      <div>
                                        <p className="text-sm font-bold text-brand-green">{inv.scheme_name}</p>
                                        <p className="text-[10px] font-mono mt-1 text-[#889995]">xSIP: {inv.xsip_reg_no}</p>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <div className="text-right">
                                          <p className="text-sm font-bold text-white">{inv.installment_amount !== "-" && !isNaN(inv.installment_amount) ? `₹${Number(inv.installment_amount).toLocaleString('en-IN')}` : inv.installment_amount}</p>
                                          <p className="text-[9px] uppercase tracking-wider text-[#889995] mt-0.5">{inv.frequency_type}</p>
                                        </div>
                                        {!isEditing && (isExpanded ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />)}
                                      </div>
                                    </div>

                                    {isExpanded && (
                                      isEditing ? (
                                        <div className="p-4 border-t border-white/5 bg-black/60 animate-in slide-in-from-top-2">
                                          <form onSubmit={handleSaveInvestment} className="flex flex-col gap-3">
                                            <div className="grid grid-cols-2 gap-3">
                                              <div>
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Folio Number</label>
                                                <input value={invForm.folio_number || ""} onChange={e => setInvForm({...invForm, folio_number: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-brand-green" />
                                              </div>
                                              <div>
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">xSIP Reg No</label>
                                                <input value={invForm.xsip_reg_no || ""} onChange={e => setInvForm({...invForm, xsip_reg_no: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-brand-green" />
                                              </div>
                                              <div className="col-span-2">
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Scheme Name</label>
                                                <input value={invForm.scheme_name || ""} onChange={e => setInvForm({...invForm, scheme_name: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-brand-green" />
                                              </div>
                                              <div>
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Amount (₹)</label>
                                                <input type="number" value={invForm.installment_amount || ""} onChange={e => setInvForm({...invForm, installment_amount: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-brand-green" />
                                              </div>
                                              <div className="col-span-2 grid grid-cols-2 gap-3 mt-2">
                                                <div>
                                                  <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Start Date</label>
                                                  <input type="date" value={toInputDate(invForm.start_date)} onChange={e => setInvForm({...invForm, start_date: toDisplayDate(e.target.value)})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-brand-green" />
                                                </div>
                                                <div>
                                                  <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">End Date</label>
                                                  <input type="date" value={toInputDate(invForm.end_date)} onChange={e => setInvForm({...invForm, end_date: toDisplayDate(e.target.value)})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-brand-green" />
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex gap-2 justify-end mt-3 border-t border-white/5 pt-3">
                                              <div className="flex-1"></div>
                                              <button type="button" onClick={() => setEditingInv(null)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/5 text-[#889995] hover:bg-white/10 transition-colors">Cancel</button>
                                              <button type="submit" className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#008254] text-white hover:bg-[#008254]/80 transition-colors">Save Details</button>
                                            </div>
                                          </form>
                                        </div>
                                      ) : (
                                        <div className="p-3 border-t border-white/5 bg-black/40 grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 relative">
                                          <div className="absolute top-3 right-3 flex items-center gap-2">
                                            <button onClick={() => { setEditingInv(inv.originalIndex); setInvForm(inv); }} className="text-[#60a5fa] bg-blue-500/10 p-1.5 rounded-md border border-blue-500/20 hover:bg-blue-500/20 transition-colors" title="Edit SIP">
                                              <Pencil size={12} />
                                            </button>
                                            <button onClick={() => handleDeleteInvestment(inv.originalIndex)} className="text-[#f87171] bg-red-500/10 p-1.5 rounded-md border border-red-500/20 hover:bg-red-500/20 transition-colors" title="Delete SIP">
                                              <Trash2 size={12} />
                                            </button>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Calendar className="w-3 h-3 text-brand-green" />
                                            <div>
                                              <p className="text-[8px] uppercase tracking-wider text-[#889995]">Start Date</p>
                                              <p className="text-[10px] text-white">{inv.start_date || "—"}</p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Calendar className="w-3 h-3 text-[#f87171]" />
                                            <div>
                                              <p className="text-[8px] uppercase tracking-wider text-[#889995]">End Date</p>
                                              <p className="text-[10px] text-white">{inv.end_date || "—"}</p>
                                            </div>
                                          </div>
                                        </div>
                                      )
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

                {/* TAB 3: FINANCIAL GOALS */}
                {activeTab === "goals" && (
                  <div className="animate-in fade-in duration-200">
                    {(!selected.financial_goals || selected.financial_goals.length === 0) ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995] mb-4">No financial goals found for this client.</p>
                        <p className="text-xs text-white/50">Use the <strong className="text-brand-green">Goal Tracker</strong> tab in the sidebar to add and configure new goals.</p>
                      </div>
                    ) : (
                      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {selected.financial_goals.map((goal, idx) => {
                          const math = calculateGoalMath(goal);
                          const targetDate = addYears(parseISO(goal.date), parseFloat(goal.years));
                          const pct = Math.min(100, Math.round((math.projectedMaturity / math.goalFV) * 100)) || 0;

                          return (
                            <div key={idx} className="p-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all">
                              <div className="flex justify-between items-start mb-4">
                                <div>
                                  <p className="text-sm font-bold text-white">{goal.goalType === "Custom..." ? goal.customGoal : goal.goalType}</p>
                                  <p className="text-[10px] text-brand-green mt-1 font-bold uppercase tracking-wider">{goal.status} · {goal.years} YRS</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] font-bold text-[#889995] uppercase">Target Date</p>
                                  <p className="text-sm font-bold text-white">{format(targetDate, "MMM yyyy")}</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                  <p className="text-[9px] font-bold text-[#889995] uppercase">Target Future Value</p>
                                  <p className="text-base font-black text-[#fbbf24]">₹{Math.round(math.goalFV).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[9px] font-bold text-[#889995] uppercase">Projected Maturity</p>
                                  <p className="text-base font-black text-[#4ade80]">₹{Math.round(math.projectedMaturity).toLocaleString('en-IN')}</p>
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between text-[10px] font-bold mb-1">
                                  <span className="text-[#889995]">Funding Progress</span>
                                  <span className={math.gap <= 0 ? "text-[#4ade80]" : "text-[#f87171]"}>{pct}%</span>
                                </div>
                                <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden">
                                  <div className="h-full bg-[#4ade80] transition-all duration-500" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: INSURANCE (LINKED POLICIES) */}
                {activeTab === "insurance" && (
                  <div className="animate-in fade-in duration-200">
                    
                    {/* Always show the search bar at the top of the insurance tab so user can manually link */}
                    <div className="mb-6">
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#889995]" />
                        <input 
                          type="text" 
                          placeholder="Search all unlinked policies by name, policy no, or plan..." 
                          value={insSearch}
                          onChange={(e) => setInsSearch(e.target.value)}
                          className="w-full bg-[#050a09] border border-white/10 text-white text-sm rounded-xl py-2.5 pl-10 pr-3 outline-none focus:border-blue-500 transition-colors"
                        />
                        {insSearch && (
                          <button onClick={() => setInsSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#889995] hover:text-white">
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {displaySuggestedPolicies.length > 0 ? (
                        <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/10">
                          {/* Header with Select All and Link button */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-3">
                            <div className="flex items-center gap-3">
                              <input 
                                type="checkbox" 
                                className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                                checked={isAllInsSelected}
                                onChange={toggleSelectAllIns}
                              />
                              <h4 className="text-sm font-bold text-blue-400 flex items-center gap-1">
                                <Info size={16} /> 
                                {insSearch ? `Search Results (${displaySuggestedPolicies.length})` : `Suggested Matches (${displaySuggestedPolicies.length})`}
                              </h4>
                            </div>
                            {selectedSuggestions.size > 0 && (
                              <button 
                                onClick={handleBulkLinkPolicies} 
                                className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 font-bold transition-all shadow-lg shadow-blue-500/20 whitespace-nowrap"
                              >
                                Link {selectedSuggestions.size} Selected
                              </button>
                            )}
                          </div>
                          
                          <p className="text-xs text-blue-300/80 mb-4">
                            {insSearch 
                              ? "Select records below to link them to this client's profile." 
                              : `We found existing records that may belong to "${selected.client_name}". Select and link them to attach them to this profile.`}
                          </p>
                          
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                            {displaySuggestedPolicies.map(p => (
                              <div key={p.docId} className="flex items-center gap-3 bg-black/40 p-3 rounded-lg border border-blue-500/20">
                                <input 
                                  type="checkbox" 
                                  className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                                  checked={selectedSuggestions.has(p.docId)}
                                  onChange={() => toggleSuggestionSelection(p.docId)}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-white flex items-center gap-2 truncate">
                                    {p.policyHolder} <span className="text-[10px] font-medium text-blue-300/70 truncate">- {p.plan}</span>
                                  </p>
                                  <p className="text-[10px] font-mono text-blue-400 mt-1">
                                    Policy: {p.policyNo} | Premium: ₹{Number(p.premiumAmount || 0).toLocaleString('en-IN')}
                                  </p>
                                </div>
                                <button 
                                  onClick={() => handleLinkSinglePolicy(p.docId)} 
                                  className="text-xs px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded border border-blue-500/30 hover:bg-blue-500 hover:text-white font-bold transition-all"
                                >
                                  Link
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        insSearch && (
                          <div className="p-4 text-center text-sm text-[#889995] border border-dashed border-white/10 rounded-xl bg-black/20">
                            No unlinked policies found matching "{insSearch}".
                          </div>
                        )
                      )}
                    </div>

                    {/* Linked Policies List */}
                    {clientPolicies.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995] mb-4">No insurance policies linked to this client.</p>
                        <p className="text-xs text-white/50">Use the search bar above to link existing records, or upload new records in the <strong>Insurance Review</strong> tab.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {clientPolicies.map(p => (
                          <div key={p.docId} className="p-4 rounded-xl border border-white/10 bg-white/5 flex justify-between items-center group hover:bg-white/10 transition-colors">
                            <div>
                              <p className="text-[10px] uppercase font-bold text-blue-400 tracking-wider mb-1 flex items-center gap-1">
                                {p.planType}
                                <span className="text-white/30">•</span>
                                <span className={p.renewalStatus === 'Renewed' ? 'text-[#4ade80]' : 'text-yellow-400'}>{p.renewalStatus}</span>
                              </p>
                              <p className="text-sm font-bold text-white">{p.plan}</p>
                              <p className="text-[10px] text-[#889995] mt-1 font-mono tracking-wider">Policy: {p.policyNo}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] uppercase font-bold text-[#889995] tracking-wider mb-1">Premium Due: {p.dueDate}</p>
                              <p className="text-sm font-black text-blue-400">₹{Number(p.premiumAmount || 0).toLocaleString('en-IN')}</p>
                              <button 
                                onClick={() => handleUnlinkPolicy(p.docId)} 
                                className="text-[10px] text-red-400 mt-1.5 opacity-0 group-hover:opacity-100 hover:underline transition-opacity"
                              >
                                Unlink Record
                              </button>
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