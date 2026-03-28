import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { 
  Search, ChevronRight, ChevronDown, ChevronUp, Save, Plus, X, Clock, 
  FileText, CheckCircle2, Filter, CalendarCheck, AlertTriangle, Star, Edit3, 
  Download, Image as ImageIcon, Target, Shield, HeartPulse, PiggyBank, 
  AlertCircle, XCircle, Wallet, Calendar, Info, Pencil, Trash2 
} from "lucide-react";
import { format, parseISO, addMonths, addYears, isBefore, isSameMonth, endOfMonth, startOfDay } from "date-fns";
import html2canvas from "html2canvas";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, orderBy, doc, updateDoc, arrayUnion, writeBatch } from "firebase/firestore";

const PRIORITIES = ["High", "Medium", "Low"];
const CYCLES = ["Monthly", "Quarterly", "Half-yearly", "Annually", "Custom"];
const GOAL_DISCUSSIONS = ["Yes", "No", "Pending"];
const GOAL_IMPLEMENTATIONS = ["Yes", "No", "In Progress"];

const emptyPlan = {
  portfolio: { net_investment: "", current_value: "", gain: "", sip: "", xirr: "", remarks: "" },
  sip_increase: "",
  mf_actions: [],
  protection: {
    term: { cover: "", range: "", suggestion: "", remarks: "" },
    health: { cover: "", range: "", suggestion: "", remarks: "" },
    accident: { cover: "", range: "", suggestion: "", remarks: "" },
    emergency: { cover: "", range: "", suggestion: "", remarks: "" },
  },
  goals: {
    retirement: { discussion: "", implementation: "", date: "", sip: "", lump_sum: "", due: "" },
    education: { discussion: "", implementation: "", date: "", sip: "", lump_sum: "", due: "" },
    marriage: { discussion: "", implementation: "", date: "", sip: "", lump_sum: "", due: "" },
    house: { discussion: "", implementation: "", date: "", sip: "", lump_sum: "", due: "" },
    wealth: { discussion: "", implementation: "", date: "", sip: "", lump_sum: "", due: "" },
  }
};

// --- GLOBAL MEMORY CACHE ---
let cachedClients = [];
let isListeningClients = false;
let clientSubs = new Set();

let cachedPolicies = [];
let isListeningPolicies = false;
let policySubs = new Set();

// --- HELPERS ---
const toInputDate = (dateStr) => {
  if (!dateStr || dateStr === "-") return "";
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd");
  } catch (e) { return ""; }
};

const toDisplayDate = (dateStr) => {
  if (!dateStr || dateStr === "-") return "-";
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : format(d, "dd MMM yyyy");
  } catch (e) { return dateStr; }
};

const getSIPTotal = (investments) => {
  return (investments || []).reduce((sum, inv) => {
    if (inv.type === "LS" || inv.frequency_type === "One-time") return sum; 
    const amt = parseFloat(String(inv.installment_amount).replace(/,/g, ''));
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);
};

export default function ClientReview() {
  const location = useLocation();

  const [clients, setClients] = useState(cachedClients);
  const [allPolicies, setAllPolicies] = useState(cachedPolicies);
  
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(cachedClients.length === 0);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [activeTab, setActiveTab] = useState("notes");

  const [showFilters, setShowFilters] = useState(false);
  
  const [filters, setFilters] = useState({ 
    rm: "", 
    cycle: "", 
    status: location.state?.filterStatus || "due",
    targetMonth: location.state?.targetMonth || format(new Date(), "yyyy-MM")
  });
  
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planMode, setPlanMode] = useState("view"); 
  const [activePlanId, setActivePlanId] = useState(null);
  const [planDraft, setPlanDraft] = useState(emptyPlan);
  const [savingPlan, setSavingPlan] = useState(false);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef(null);

  // --- SIP PORTFOLIO STATES ---
  const [expandedInv, setExpandedInv] = useState(null);
  const [editingInv, setEditingInv] = useState(null);
  const [invForm, setInvForm] = useState({});

  // --- INSURANCE INTEGRATION STATES ---
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());
  const [insSearch, setInsSearch] = useState("");

  useEffect(() => {
    if (location.state?.filterStatus) {
      setFilters(prev => ({
        ...prev,
        status: location.state.filterStatus,
        targetMonth: location.state.targetMonth || prev.targetMonth
      }));
    }
  }, [location.state]);

  useEffect(() => {
    clientSubs.add(setClients);
    if (!isListeningClients) {
      isListeningClients = true;
      const q = query(collection(db, "clients"), orderBy("client_name"));
      onSnapshot(q, (snapshot) => {
        cachedClients = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        clientSubs.forEach(cb => cb(cachedClients));
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    policySubs.add(setAllPolicies);
    if (!isListeningPolicies) {
      isListeningPolicies = true;
      onSnapshot(collection(db, "insurance_policies"), (snap) => {
        cachedPolicies = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
        policySubs.forEach(cb => cb(cachedPolicies));
      });
    }

    return () => {
      clientSubs.delete(setClients);
      policySubs.delete(setAllPolicies);
    };
  }, []);

  useEffect(() => {
    if (selected) {
      const updated = clients.find(c => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  }, [clients]);

  useEffect(() => {
    setSelectedSuggestions(new Set());
    setInsSearch("");
    setExpandedInv(null);
    setEditingInv(null);
  }, [selected]);

  const uniqueRMs = [...new Set(clients.map(c => c.rm_assigned).filter(v => v && v !== "-"))].sort();

  const filtered = clients.filter(c => {
    const matchesSearch = search.length < 1 || 
      c.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.client_code?.toLowerCase().includes(search.toLowerCase());
    
    const matchesRm = filters.rm === "" || c.rm_assigned === filters.rm;
    const matchesCycle = filters.cycle === "" || c.review_cycle === filters.cycle;
    
    let matchesStatus = true;
    if (filters.status === "due") {
      if (!c.next_review_date) matchesStatus = true;
      else {
        const reviewDate = parseISO(c.next_review_date);
        const endOfCurrentMonth = endOfMonth(new Date());
        matchesStatus = isBefore(reviewDate, endOfCurrentMonth) || isSameMonth(reviewDate, endOfCurrentMonth);
      }
    } else if (filters.status === "unscheduled") {
      matchesStatus = !c.next_review_date;
    } else if (filters.status === "current_month") {
      if (!c.next_review_date) matchesStatus = false;
      else matchesStatus = isSameMonth(parseISO(c.next_review_date), new Date());
    } else if (filters.status === "specific_month") {
      if (!c.next_review_date) matchesStatus = false;
      else matchesStatus = c.next_review_date.startsWith(filters.targetMonth);
    } else if (filters.status === "completed") {
      matchesStatus = (c.review_notes || []).some(n => n.date.startsWith(filters.targetMonth) && n.text.includes("Review Completed"));
    }
    
    return matchesSearch && matchesRm && matchesCycle && matchesStatus;
  });

  const groupedClients = Object.values(filtered.reduce((acc, c) => {
    const key = c.client_name?.trim().toLowerCase() || "unknown";
    if (!acc[key]) acc[key] = { client_name: c.client_name || "Unknown", profiles: [] };
    acc[key].profiles.push(c);
    return acc;
  }, {})).sort((a, b) => a.client_name.localeCompare(b.client_name));

  const activeFilterCount = Object.values(filters).filter(v => v !== "" && v !== "all" && v !== "due").length + (filters.status !== "all" && filters.status !== "due" ? 1 : 0);

  const updateClientMeta = async (field, value) => {
    if (!selected) return;
    try { await updateDoc(doc(db, "clients", selected.id), { [field]: value }); } 
    catch (e) { console.error("Error updating meta:", e); }
  };

  const handleCycleChange = async (e) => {
    const newCycle = e.target.value;
    updateClientMeta('review_cycle', newCycle);
    if (newCycle && !selected.next_review_date) {
      updateClientMeta('next_review_date', format(new Date(), "yyyy-MM-dd"));
    }
  };

  const handleCompleteReview = async () => {
    if (!selected.review_cycle || !selected.next_review_date) {
      alert("Please set a Review Cycle and Next Review Date before completing.");
      return;
    }
    setSavingNote(true);
    try {
      const currentReviewDate = parseISO(selected.next_review_date);
      let nextDateStr = "";
      if (selected.review_cycle === "Monthly") nextDateStr = format(addMonths(currentReviewDate, 1), "yyyy-MM-dd");
      else if (selected.review_cycle === "Quarterly") nextDateStr = format(addMonths(currentReviewDate, 3), "yyyy-MM-dd");
      else if (selected.review_cycle === "Half-yearly") nextDateStr = format(addMonths(currentReviewDate, 6), "yyyy-MM-dd");
      else if (selected.review_cycle === "Annually") nextDateStr = format(addYears(currentReviewDate, 1), "yyyy-MM-dd");

      const autoNoteStr = nextDateStr 
        ? `✅ Review Completed. Next review automatically scheduled for ${format(parseISO(nextDateStr), "dd MMM yyyy")}.`
        : `✅ Review Completed. Please select a new custom date for the next review.`;

      const noteObj = { id: Date.now().toString(), text: autoNoteStr, date: format(new Date(), "yyyy-MM-dd HH:mm:ss") };
      await updateDoc(doc(db, "clients", selected.id), {
        next_review_date: nextDateStr,
        review_notes: arrayUnion(noteObj)
      });
    } catch (e) { console.error(e); } finally { setSavingNote(false); }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selected) return;
    setSavingNote(true);
    try {
      const noteObj = { id: Date.now().toString(), text: newNote.trim(), date: format(new Date(), "yyyy-MM-dd HH:mm:ss") };
      await updateDoc(doc(db, "clients", selected.id), { review_notes: arrayUnion(noteObj) });
      setNewNote("");
    } catch (e) { console.error(e); } finally { setSavingNote(false); }
  };

  // --- REPORT MODAL HELPERS ---
  const handleCreateNewPlan = () => { setPlanDraft(emptyPlan); setActivePlanId(null); setPlanMode("edit"); setShowPlanModal(true); };
  const handleViewPlan = (plan) => { setPlanDraft(plan); setActivePlanId(plan.id); setPlanMode("view"); setShowPlanModal(true); };
  const handleSavePlan = async () => {
    if (!selected) return;
    setSavingPlan(true);
    try {
      const plans = selected.review_plans || [];
      let newPlans = [...plans];
      if (activePlanId) {
        const idx = newPlans.findIndex(p => p.id === activePlanId);
        if (idx > -1) newPlans[idx] = { ...planDraft, id: activePlanId, date: planDraft.date || format(new Date(), "yyyy-MM-dd") };
      } else {
        newPlans.push({ id: Date.now().toString(), date: format(new Date(), "yyyy-MM-dd"), ...planDraft });
      }
      await updateDoc(doc(db, "clients", selected.id), { review_plans: newPlans });
      setShowPlanModal(false);
    } catch (e) { console.error(e); alert("Failed to save plan."); } finally { setSavingPlan(false); }
  };

  const handleDownloadImage = async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const element = printRef.current;
      const originalHeight = element.style.height;
      const originalOverflow = element.style.overflow;
      element.style.height = 'auto';
      element.style.overflow = 'visible';

      const canvas = await html2canvas(element, { backgroundColor: '#0a1612', scale: 2, useCORS: true, logging: false });
      const link = document.createElement('a');
      link.download = `${selected?.client_name.replace(/\s+/g, '_')}_Review.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      element.style.height = originalHeight;
      element.style.overflow = originalOverflow;
    } catch (err) { console.error(err); } finally { setExporting(false); }
  };

  const setNested = (section, field, value) => { setPlanDraft(p => ({ ...p, [section]: { ...p[section], [field]: value } })); };
  const setDoubleNested = (section, item, field, value) => { setPlanDraft(p => ({ ...p, [section]: { ...p[section], [item]: { ...p[section][item], [field]: value } } })); };
  const addMfAction = () => { setPlanDraft(p => ({ ...p, mf_actions: [...(p.mf_actions || []), { fund: "", sip_increase: "", sip_cease: "", switch: "", redemption: "", action: "", suggestion: "", remarks: "" }] })); };
  const updateMfAction = (index, field, value) => { setPlanDraft(p => { const updated = [...p.mf_actions]; updated[index][field] = value; return { ...p, mf_actions: updated }; }); };
  const removeMfAction = (index) => { setPlanDraft(p => ({ ...p, mf_actions: p.mf_actions.filter((_, i) => i !== index) })); };

  // --- SIP PORTFOLIO ACTIONS ---
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
    } catch (err) { console.error("Error linking policy:", err); alert("Failed to link policy."); }
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
    } catch (err) { console.error("Error bulk linking policies:", err); alert("Failed to link policies."); }
  };

  const handleUnlinkPolicy = async (policyDocId) => {
    if (!window.confirm("Are you sure you want to unlink this policy from this client?")) return;
    try {
      await updateDoc(doc(db, "insurance_policies", policyDocId), {
        linkedClientId: null,
        linkedClientName: null
      });
    } catch (err) { console.error("Error unlinking policy:", err); }
  };

  const toggleSuggestionSelection = (docId) => {
    const newSet = new Set(selectedSuggestions);
    if (newSet.has(docId)) newSet.delete(docId); else newSet.add(docId);
    setSelectedSuggestions(newSet);
  };

  // --- UI RENDER HELPERS ---
  const renderProfileButton = (c, isSubItem) => {
    const isActive = selected?.id === c.id;
    let dueColor = "var(--text-muted)";
    let dueText = "Unscheduled";

    if (c.next_review_date) {
      const revDate = parseISO(c.next_review_date);
      dueText = format(revDate, "MMM yyyy");
      if (filters.status === "completed") {
        dueColor = "#4ade80"; 
      } else if (filters.status === "specific_month" || filters.status === "current_month") {
        dueColor = "#60a5fa"; 
      } else if (isBefore(revDate, startOfDay(new Date()))) {
        dueColor = "#f87171"; 
      } else if (isSameMonth(revDate, new Date())) {
        dueColor = "#fbbf24"; 
      }
    } else {
      dueColor = "#f87171"; 
    }

    return (
      <button
        key={c.id}
        onClick={() => { setSelected(c); setExpandedGroup(null); }}
        className={`w-full text-left py-3 flex items-center gap-3 transition-colors ${isSubItem ? 'pl-10 pr-4 border-l-2 border-brand-green/40 hover:bg-white/5' : 'px-4 hover:bg-white/5 border-b border-[var(--border)]'}`}
        style={{ background: isActive ? "rgba(0, 130, 84, 0.12)" : "transparent" }}
      >
        {!isSubItem && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm"
            style={{ background: isActive ? "var(--brand-green)" : "rgba(255,255,255,0.07)", color: isActive ? "white" : "var(--brand-green)" }}>
            {c.client_name?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>
            {isSubItem ? (c.tax_status && c.tax_status !== "-" ? c.tax_status : "Standard Profile") : c.client_name}
          </p>
          <div className="flex items-center gap-1 mt-0.5 text-[10px] font-bold" style={{ color: dueColor }}>
            <Clock size={10} />
            <span>{dueText}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>
    );
  };

  // --- DERIVED DATA FOR TABS ---
  const sipInvestmentsWithIndex = selected ? (selected.investments || [])
    .map((inv, idx) => ({ ...inv, originalIndex: idx }))
    .filter(inv => inv.type !== "LS" && inv.frequency_type !== "One-time") : [];

  const clientPolicies = selected ? allPolicies.filter(p => p.linkedClientId === selected.id) : [];
  
  const displaySuggestedPolicies = selected ? allPolicies.filter(p => {
    if (p.linkedClientId) return false;
    if (insSearch.trim().length > 0) {
      const q = insSearch.toLowerCase();
      return (p.policyHolder?.toLowerCase().includes(q) || p.policyNo?.toLowerCase().includes(q) || p.plan?.toLowerCase().includes(q));
    } else {
      const cName = String(selected.client_name || "").toLowerCase().trim();
      const pName = String(p.policyHolder || "").toLowerCase().trim();
      if (!cName || !pName) return false;
      if (cName === pName) return true;
      const cParts = cName.split(/[\s,.-]+/).filter(x => x.length > 2); 
      const pParts = pName.split(/[\s,.-]+/).filter(x => x.length > 2);
      return cParts.some(cp => pParts.includes(cp));
    }
  }) : [];

  const isAllInsSelected = displaySuggestedPolicies.length > 0 && displaySuggestedPolicies.every(p => selectedSuggestions.has(p.docId));
  const toggleSelectAllIns = () => {
    const newSet = new Set(selectedSuggestions);
    if (isAllInsSelected) displaySuggestedPolicies.forEach(p => newSet.delete(p.docId));
    else displaySuggestedPolicies.forEach(p => newSet.add(p.docId));
    setSelectedSuggestions(newSet);
  };

  // Styles
  const iStyle = { padding: "8px 12px", borderRadius: 8, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 13, width: "100%", outline: "none" };
  const inputStyle = { padding: "6px 10px", borderRadius: 6, background: "#0a1612", border: "1px solid rgba(255,255,255,0.15)", color: "#c8d4d0", fontSize: 12, width: "100%" };
  const tInputStyle = { width: "100%", background: "rgba(255,255,255,0.05)", border: "none", borderRadius: "4px", padding: "6px 8px", color: "#fff", outline: "none", fontSize: "13px" };
  const thStyle = { padding: "16px", textAlign: "left", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, color: "#889995", borderBottom: "1px solid rgba(255,255,255,0.05)" };
  const tdStyle = { padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 13, fontWeight: 700, color: "#fff" };
  const sectionHeaderStyle = { padding: "12px 20px", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1 };

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh", color: "var(--text-main)" }}>
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%); cursor: pointer; }
        input[type="date"] { color-scheme: dark; color: #fbbf24 !important; font-weight: 700; }
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
        .report-table-row:hover { background: rgba(255,255,255,0.02); }
      `}</style>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>Client Review Dashboard</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Schedule and manage periodic portfolio reviews.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar (List & Filters) */}
        <div className="lg:col-span-1 rounded-2xl flex flex-col sticky top-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)", height: "calc(100vh - 120px)" }}>
          <div className="p-4 flex-shrink-0 z-20 bg-[#0a1612] rounded-t-2xl" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex gap-2 relative">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
                <input 
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm" 
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-main)" }}
                  placeholder="Search clients..." 
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

              {showFilters && (
                <div className="absolute top-[115%] right-0 w-64 p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-top-2" style={{ background: "#0a1612", borderColor: "var(--border)", zIndex: 100 }}>
                  <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-white">Review Filters</p>
                    {activeFilterCount > 0 && (
                      <button onClick={() => setFilters({rm: "", cycle: "", status: "all", targetMonth: format(new Date(), "yyyy-MM")})} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold">
                        <XCircle className="w-3 h-3" /> Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">Review Status</label>
                      <div className="flex flex-col gap-1.5 bg-black border border-white/10 rounded-xl p-1.5">
                        <button onClick={() => setFilters({...filters, status: "due"})} className={`w-full py-2 text-xs font-bold rounded-lg transition-all ${filters.status === 'due' ? 'bg-[#fbbf24]/20 text-[#fbbf24]' : 'text-[#889995] hover:text-white hover:bg-white/5'}`}>Due / Overdue</button>
                        <button onClick={() => setFilters({...filters, status: "current_month"})} className={`w-full py-2 text-xs font-bold rounded-lg transition-all ${filters.status === 'current_month' ? 'bg-[#60a5fa]/20 text-[#60a5fa]' : 'text-[#889995] hover:text-white hover:bg-white/5'}`}>This Month</button>
                        <button onClick={() => setFilters({...filters, status: "unscheduled"})} className={`w-full py-2 text-xs font-bold rounded-lg transition-all ${filters.status === 'unscheduled' ? 'bg-[#f87171]/20 text-[#f87171]' : 'text-[#889995] hover:text-white hover:bg-white/5'}`}>Unscheduled Only</button>
                        <button onClick={() => setFilters({...filters, status: "completed"})} className={`w-full py-2 text-xs font-bold rounded-lg transition-all ${filters.status === 'completed' ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'text-[#889995] hover:text-white hover:bg-white/5'}`}>Completed</button>
                        <button onClick={() => setFilters({...filters, status: "all"})} className={`w-full py-2 text-xs font-bold rounded-lg transition-all ${filters.status === 'all' ? 'bg-white/10 text-white' : 'text-[#889995] hover:text-white hover:bg-white/5'}`}>All Clients</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">RM Assigned</label>
                      <select value={filters.rm} onChange={e => setFilters({...filters, rm: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="">All RMs</option>
                        {uniqueRMs.map(rm => <option key={rm} value={rm}>{rm}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">Review Cycle</label>
                      <select value={filters.cycle} onChange={e => setFilters({...filters, cycle: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 focus:ring-1 focus:ring-brand-green outline-none">
                        <option value="">All Cycles</option>
                        {CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* DYNAMIC ALERT BANNER */}
            {(filters.status === "due" || filters.status === "unscheduled" || filters.status === "current_month" || filters.status === "specific_month" || filters.status === "completed") && (
              <div className={`mt-3 p-2.5 rounded-xl border flex items-center justify-center gap-2 
                ${filters.status === "unscheduled" ? "bg-red-500/10 border-red-500/20" : 
                  filters.status === "completed" ? "bg-[#4ade80]/10 border-[#4ade80]/30" : 
                  (filters.status === "current_month" || filters.status === "specific_month") ? "bg-blue-500/10 border-blue-500/20" : 
                  "bg-amber-500/10 border-amber-500/20"}`}>
                <AlertCircle className={`w-4 h-4 
                  ${filters.status === "unscheduled" ? "text-red-400" : 
                    filters.status === "completed" ? "text-[#4ade80]" : 
                    (filters.status === "current_month" || filters.status === "specific_month") ? "text-blue-400" : 
                    "text-amber-400"}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider 
                  ${filters.status === "unscheduled" ? "text-red-400" : 
                    filters.status === "completed" ? "text-[#4ade80]" : 
                    (filters.status === "current_month" || filters.status === "specific_month") ? "text-blue-400" : 
                    "text-amber-400"}`}>
                  {filters.status === "unscheduled" ? "Showing Unscheduled" : 
                   filters.status === "completed" ? `Completed in ${format(parseISO(`${filters.targetMonth}-01`), "MMM yyyy")}` : 
                   filters.status === "current_month" ? `Showing ${format(new Date(), "MMMM")} Reviews` : 
                   filters.status === "specific_month" ? `Showing ${format(parseISO(`${filters.targetMonth}-01`), "MMMM yyyy")} Reviews` : 
                   "Showing Due / Overdue"}
                </span>
              </div>
            )}
          </div>
          
          <div className="overflow-y-auto flex-1 z-10 custom-scrollbar">
            {loading ? <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading database...</div> : 
             filtered.length === 0 ? <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No reviews match the criteria</div> : 
             groupedClients.map(group => {
                const isMultiple = group.profiles.length > 1;
                const groupKey = group.client_name?.toLowerCase() || "unknown";
                const isExpanded = expandedGroup === groupKey;
                
                if (isMultiple) {
                  return (
                    <div key={groupKey} className="border-b border-[var(--border)]">
                      <button onClick={() => setExpandedGroup(isExpanded ? null : groupKey)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm bg-white/5 text-white/50">{group.client_name?.[0]?.toUpperCase() || "?"}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{group.client_name}</p>
                          <p className="text-[10px] text-brand-green mt-0.5 font-bold uppercase">{group.profiles.length} Profiles</p>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                      </button>
                      {isExpanded && <div className="bg-black/40 pb-2 shadow-inner">
                        {group.profiles.map(c => renderProfileButton(c, true))}
                      </div>}
                    </div>
                  );
                } else {
                  return renderProfileButton(group.profiles[0], false);
                }
              })
            }
          </div>
        </div>

        {/* Right Main Content */}
        <div className="lg:col-span-3 space-y-4">
          {!selected ? (
            <div className="rounded-2xl flex flex-col items-center justify-center min-h-[400px] text-center" style={{ background: "var(--glass)", border: "1px solid var(--border)" }}>
              <CalendarCheck className="w-12 h-12 mb-4 text-brand-green" />
              <h2 className="text-xl font-bold text-white mb-2">Review Management</h2>
              <p className="text-[#889995] max-w-sm">Select a client from the list to schedule, manage, and complete their portfolio reviews.</p>
            </div>
          ) : (
            <>
              {/* Header Info & Scheduling Card */}
              <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
                <button onClick={handleCompleteReview} disabled={savingNote} className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4ade80] text-black text-xs font-black shadow-[0_0_15px_rgba(74,222,128,0.3)] hover:scale-105 transition-all disabled:opacity-50">
                  <CheckCircle2 size={16} /> {savingNote ? "Completing..." : "Mark Review Complete"}
                </button>

                <div className="flex items-start justify-between mb-6 pb-6 border-b border-white/10">
                  <div>
                    <h2 className="text-3xl font-black text-white tracking-tight">{selected.client_name}</h2>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-sm font-mono font-bold text-[#4ade80] bg-[#4ade80]/10 px-2 py-0.5 rounded">{selected.client_code}</span>
                      <span className="text-xs text-[#889995] font-bold uppercase tracking-wider">{selected.rm_assigned || "No RM Assigned"}</span>
                    </div>
                  </div>
                </div>

                {/* Scheduling Parameters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-[#889995] uppercase tracking-wider mb-2 block">Priority Level</label>
                    <select value={selected.priority || ""} onChange={e => updateClientMeta('priority', e.target.value)} style={{...iStyle, background: "#050a09"}}>
                      <option value="">Select Priority...</option>
                      {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#889995] uppercase tracking-wider mb-2 block">Review Cycle</label>
                    <select value={selected.review_cycle || ""} onChange={handleCycleChange} style={{...iStyle, background: "#050a09"}}>
                      <option value="">Select Cycle...</option>
                      {CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#fbbf24] uppercase tracking-wider mb-2 flex items-center gap-1">
                      Next Review Date <Star size={10} />
                    </label>
                    <input type="date" value={selected.next_review_date || format(new Date(), "yyyy-MM-dd")} onChange={e => updateClientMeta('next_review_date', e.target.value)} style={{...iStyle, background: "#050a09", borderColor: "rgba(251,191,36,0.3)"}} />
                  </div>
                </div>
              </div>

              {/* Tabs Container */}
              <div className="rounded-2xl p-6" style={{ background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
                
                {/* TABS NAVIGATION */}
                <div className="flex gap-6 border-b border-white/10 mb-6 overflow-x-auto custom-scrollbar whitespace-nowrap pb-1">
                  <button onClick={() => setActiveTab('notes')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'notes' ? 'text-[#4ade80] border-b-2 border-[#4ade80]' : 'text-[#889995] hover:text-white'}`}>
                    <Clock className="w-4 h-4" /> Review Notes Log
                  </button>
                  <button onClick={() => setActiveTab('plan')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'plan' ? 'text-[#4ade80] border-b-2 border-[#4ade80]' : 'text-[#889995] hover:text-white'}`}>
                    <FileText className="w-4 h-4" /> Document History
                  </button>
                  <button onClick={() => setActiveTab('portfolio')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'portfolio' ? 'text-[#4ade80] border-b-2 border-[#4ade80]' : 'text-[#889995] hover:text-white'}`}>
                    <Wallet className="w-4 h-4" /> SIPs ({sipInvestmentsWithIndex.length})
                  </button>
                  <button onClick={() => setActiveTab('insurance')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'insurance' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-[#889995] hover:text-white'}`}>
                    <Shield className="w-4 h-4" /> Insurance ({clientPolicies.length})
                  </button>
                </div>

                {/* TAB 1: NOTES TIMELINE */}
                {activeTab === "notes" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="mb-8 p-4 rounded-xl border border-white/10 bg-black/20">
                      <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Write a new review note or meeting summary..." rows={3} style={{ ...iStyle, border: "none", background: "transparent", padding: 0, resize: "none" }} />
                      <div className="flex justify-end mt-3">
                        <button onClick={handleAddNote} disabled={savingNote || !newNote.trim()} className="px-5 py-2 rounded-lg bg-[#008254] text-white text-xs font-bold disabled:opacity-50 transition-colors">
                          {savingNote ? "Saving..." : "Save Note"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4 pl-2 border-l-2 border-white/5 ml-2">
                      {(!selected.review_notes || selected.review_notes.length === 0) ? (
                        <p className="text-sm text-white/30 italic pl-4">No review notes recorded yet.</p>
                      ) : (
                        [...selected.review_notes].sort((a,b) => new Date(b.date) - new Date(a.date)).map((note, i) => (
                          <div key={note.id || i} className="relative pl-6">
                            <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full bg-[#4ade80] ring-4 ring-[#050a09]" />
                            <p className="text-[10px] font-bold text-[#889995] mb-1">{format(new Date(note.date), "dd MMM yyyy, hh:mm a")}</p>
                            <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-sm text-[#c8d4d0] whitespace-pre-wrap leading-relaxed">
                              {note.text}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: REVIEW PLAN HISTORY */}
                {activeTab === "plan" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="flex justify-between items-center mb-6">
                      <p className="text-sm font-bold text-white">Review Documents</p>
                      <button onClick={handleCreateNewPlan} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4ade80] text-black text-xs font-black shadow-[0_0_10px_rgba(74,222,128,0.2)] hover:scale-105 transition-all">
                        <Plus className="w-4 h-4" /> Create New Report
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {(!selected.review_plans || selected.review_plans.length === 0) ? (
                        <div className="col-span-full py-10 text-center border border-dashed border-white/10 rounded-xl bg-white/5">
                          <p className="text-[#889995] text-sm italic">No review plans exist for this client.</p>
                        </div>
                      ) : (
                        [...selected.review_plans].sort((a,b) => new Date(b.date) - new Date(a.date)).map(plan => (
                          <button key={plan.id} onClick={() => handleViewPlan(plan)} className="text-left p-5 rounded-xl border border-white/10 bg-black/20 hover:bg-white/5 hover:border-white/20 transition-all group">
                            <div className="flex justify-between items-start mb-3">
                              <div className="w-10 h-10 rounded-full bg-[#008254]/20 text-[#4ade80] flex items-center justify-center group-hover:scale-110 transition-transform">
                                <FileText size={18} />
                              </div>
                              <span className="text-[10px] font-bold text-[#889995] uppercase bg-white/5 px-2 py-1 rounded">Report</span>
                            </div>
                            <p className="text-sm font-bold text-white mb-1">Review on {format(parseISO(plan.date || plan.id.substring(0,10)), "dd MMM yyyy")}</p>
                            <p className="text-xs text-[#889995] line-clamp-1">Net Inv: {plan.portfolio?.net_investment || "N/A"}</p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 3: INVESTMENT PORTFOLIO (SIPS ONLY) */}
                {activeTab === "portfolio" && (
                  <div className="animate-in fade-in duration-200">
                    <div className="flex justify-end mb-4">
                      <span className="text-xs font-bold px-3 py-1.5 rounded-lg border border-[#4ade80]/30 bg-[#4ade80]/10 text-[#4ade80]">
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
                                  <div key={idx} className="rounded-lg overflow-hidden transition-all border border-white/5 bg-black/20 hover:border-white/10">
                                    <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-white/5" onClick={() => { if(!isEditing) setExpandedInv(isExpanded ? null : inv.originalIndex) }}>
                                      <div>
                                        <p className="text-sm font-bold text-[#4ade80]">{inv.scheme_name}</p>
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
                                                <input value={invForm.folio_number || ""} onChange={e => setInvForm({...invForm, folio_number: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]" />
                                              </div>
                                              <div>
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">xSIP Reg No</label>
                                                <input value={invForm.xsip_reg_no || ""} onChange={e => setInvForm({...invForm, xsip_reg_no: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]" />
                                              </div>
                                              <div className="col-span-2">
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Scheme Name</label>
                                                <input value={invForm.scheme_name || ""} onChange={e => setInvForm({...invForm, scheme_name: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]" />
                                              </div>
                                              <div>
                                                <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Amount (₹)</label>
                                                <input type="number" value={invForm.installment_amount || ""} onChange={e => setInvForm({...invForm, installment_amount: e.target.value})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]" />
                                              </div>
                                              <div className="col-span-2 grid grid-cols-2 gap-3 mt-2">
                                                <div>
                                                  <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">Start Date</label>
                                                  <input type="date" value={toInputDate(invForm.start_date)} onChange={e => setInvForm({...invForm, start_date: toDisplayDate(e.target.value)})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]" />
                                                </div>
                                                <div>
                                                  <label className="text-[9px] uppercase font-bold text-[#889995] mb-1 block">End Date</label>
                                                  <input type="date" value={toInputDate(invForm.end_date)} onChange={e => setInvForm({...invForm, end_date: toDisplayDate(e.target.value)})} className="w-full bg-[#0a1612] border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]" />
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
                                            <Calendar className="w-3 h-3 text-[#4ade80]" />
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

                {/* TAB 4: INSURANCE (LINKED POLICIES) */}
                {activeTab === "insurance" && (
                  <div className="animate-in fade-in duration-200">
                    
                    {/* Suggestion Banner */}
                    {displaySuggestedPolicies.length > 0 && (
                      <div className="mb-6 p-4 rounded-xl border border-blue-500/30 bg-blue-500/10">
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
                        
                        {/* Search bar inside the suggestion banner for clarity */}
                        <div className="relative mb-4">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#889995]" />
                          <input 
                            type="text" 
                            placeholder="Search all unlinked policies to manually link..." 
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
                    )}

                    {/* Linked Policies List */}
                    {clientPolicies.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                        <p className="text-sm text-[#889995] mb-4">No insurance policies linked to this client.</p>
                        <p className="text-xs text-white/50">If policies exist, search for them above to link them.</p>
                        
                        {displaySuggestedPolicies.length === 0 && !insSearch && (
                           <div className="relative mt-4 max-w-sm mx-auto">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#889995]" />
                            <input 
                              type="text" 
                              placeholder="Search all unlinked policies..." 
                              value={insSearch}
                              onChange={(e) => setInsSearch(e.target.value)}
                              className="w-full bg-[#050a09] border border-white/10 text-white text-sm rounded-xl py-2.5 pl-10 pr-3 outline-none focus:border-blue-500 transition-colors text-left"
                            />
                          </div>
                        )}
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

      {/* MASSIVE MODAL FOR VIEW / EDIT PLAN */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm print-modal">
          <div className="w-full max-w-6xl bg-[#0a1612] border border-white/10 rounded-xl flex flex-col max-h-[95vh] shadow-2xl relative overflow-hidden print-modal">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-[#050a09] shrink-0 hide-on-print">
              <div>
                <h2 className="text-lg font-black text-white">{planMode === 'edit' ? (activePlanId ? 'Edit Review Document' : 'New Review Document') : 'View Review Document'}</h2>
                <p className="text-[10px] text-[#4ade80] uppercase tracking-widest font-bold mt-1">{selected?.client_name}</p>
              </div>
              <div className="flex items-center gap-3">
                {planMode === 'view' && (
                  <>
                    <button onClick={handleDownloadImage} disabled={exporting} className="px-4 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-bold flex items-center gap-2 hover:bg-blue-500/30 transition-colors disabled:opacity-50">
                      {exporting ? <Clock size={14} className="animate-spin" /> : <ImageIcon size={14} />} 
                      {exporting ? "Processing..." : "Download Image"}
                    </button>
                    <button onClick={() => setPlanMode('edit')} className="px-4 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold flex items-center gap-2 hover:bg-white/20 transition-colors">
                      <Edit3 size={14} /> Edit Data
                    </button>
                  </>
                )}
                {planMode === 'edit' && (
                  <button onClick={handleSavePlan} disabled={savingPlan} className="px-5 py-1.5 rounded-lg bg-[#4ade80] text-black text-xs font-black flex items-center gap-2 hover:bg-[#22c55e] transition-colors disabled:opacity-50">
                    <Save size={14} /> {savingPlan ? "Saving..." : "Save Draft"}
                  </button>
                )}
                <div className="w-px h-6 bg-white/20 mx-1"></div>
                <button onClick={() => setShowPlanModal(false)} className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"><X size={18}/></button>
              </div>
            </div>

            {/* Modal Body - Tabular Layout perfectly matching the image */}
            <div className="p-4 lg:p-8 overflow-y-auto flex-1 custom-scrollbar bg-[#0a1612]">
              <div ref={printRef} className="max-w-[1200px] mx-auto space-y-6 bg-[#0a1612] px-2 pb-8">
                
                {/* Clean PDF Header */}
                <div className="text-center mb-8 pt-4 pb-8">
                  <h1 className="text-[28px] font-black text-white tracking-wider flex items-center justify-center gap-4 uppercase">
                    {selected?.client_name} 
                    <span className="text-white/40 font-light text-2xl">|</span> 
                    <span className="font-bold">Portfolio Review Report</span>
                  </h1>
                  <p className="text-[10px] font-bold text-[#889995] mt-3 uppercase tracking-[0.15em]">
                    REPORT GENERATED: {planDraft.date ? format(parseISO(planDraft.date), "dd MMMM yyyy") : format(new Date(), "dd MMMM yyyy")}
                  </p>
                </div>

                {/* SECTION 1: MUTUAL FUND PORTFOLIO */}
                <div className="rounded-xl overflow-hidden border border-white/5 bg-[#0a1612]">
                  <div style={{ ...sectionHeaderStyle, background: "#1c2a38", color: "#5c8bc0" }}>Mutual Fund Portfolio</div>
                  <div className="grid grid-cols-2 md:grid-cols-6 border-t border-white/5">
                    {["Net Investment", "Current Value", "Gain", "SIP", "XIRR", "Remarks"].map((lbl, i) => {
                      const keys = ["net_investment", "current_value", "gain", "sip", "xirr", "remarks"];
                      return (
                        <div key={lbl} className="p-4 border-r border-b md:border-b-0 border-white/5 last:border-r-0">
                          <label className="text-[10px] font-bold text-[#889995] uppercase block mb-2">{lbl}</label>
                          {planMode === 'edit' ? (
                            <input value={planDraft.portfolio?.[keys[i]] || ""} onChange={e => setNested('portfolio', keys[i], e.target.value)} style={tInputStyle} />
                          ) : (
                            <div className="text-[13px] font-bold text-white min-h-[20px]">{planDraft.portfolio?.[keys[i]] || "—"}</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* SECTION 2: SIP TO INCREASE */}
                <div className="rounded-xl overflow-hidden border border-white/5 bg-[#0a1612]">
                  <div style={{ ...sectionHeaderStyle, background: "#2b1b2d", color: "#b366a9" }}>SIP To Increase</div>
                  <div className="p-4 border-t border-white/5">
                    {planMode === 'edit' ? (
                      <input placeholder="Enter amount or details..." value={planDraft.sip_increase || ""} onChange={e => setPlanDraft(p => ({...p, sip_increase: e.target.value}))} style={tInputStyle} />
                    ) : (
                      <div className="text-[13px] font-bold text-white min-h-[20px]">{planDraft.sip_increase || "—"}</div>
                    )}
                  </div>
                </div>

                {/* SECTION 3: MF ACTION */}
                <div className="rounded-xl overflow-hidden border border-white/5 bg-[#0a1612]">
                  <div style={{ ...sectionHeaderStyle, background: "#382e18", color: "#cda632" }}>MF Action</div>
                  <div className="overflow-x-auto border-t border-white/5">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                      <thead>
                        <tr>
                          <th style={{...thStyle, width: "60px"}}>S No</th>
                          <th style={thStyle}>Fund</th>
                          <th style={thStyle}>SIP Inc.</th>
                          <th style={thStyle}>SIP Cease</th>
                          <th style={thStyle}>Switch</th>
                          <th style={thStyle}>Redemption</th>
                          <th style={thStyle}>Action</th>
                          <th style={thStyle}>Suggestion</th>
                          <th style={thStyle}>Remarks</th>
                          {planMode === 'edit' && <th style={{...thStyle, width:"40px"}}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {planDraft.mf_actions?.length > 0 ? planDraft.mf_actions.map((act, i) => (
                          <tr key={i} className="report-table-row">
                            <td style={{...tdStyle, color:"#889995"}}>{i+1}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.fund} onChange={e => updateMfAction(i, 'fund', e.target.value)} style={tInputStyle} /> : (act.fund || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.sip_increase} onChange={e => updateMfAction(i, 'sip_increase', e.target.value)} style={tInputStyle} /> : (act.sip_increase || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.sip_cease} onChange={e => updateMfAction(i, 'sip_cease', e.target.value)} style={tInputStyle} /> : (act.sip_cease || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.switch} onChange={e => updateMfAction(i, 'switch', e.target.value)} style={tInputStyle} /> : (act.switch || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.redemption} onChange={e => updateMfAction(i, 'redemption', e.target.value)} style={tInputStyle} /> : (act.redemption || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.action} onChange={e => updateMfAction(i, 'action', e.target.value)} style={tInputStyle} /> : (act.action || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.suggestion} onChange={e => updateMfAction(i, 'suggestion', e.target.value)} style={tInputStyle} /> : (act.suggestion || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.remarks} onChange={e => updateMfAction(i, 'remarks', e.target.value)} style={tInputStyle} /> : (act.remarks || "—")}</td>
                            {planMode === 'edit' && (
                              <td style={tdStyle}><button onClick={() => removeMfAction(i)} className="text-red-400 hover:bg-red-400/20 p-1.5 rounded transition-colors"><X size={14}/></button></td>
                            )}
                          </tr>
                        )) : (
                          <tr><td colSpan={planMode === 'edit' ? 10 : 9} style={{...tdStyle, textAlign:"center", color:"#889995", fontStyle:"italic", padding:"24px"}}>No MF actions recorded.</td></tr>
                        )}
                      </tbody>
                    </table>
                    {planMode === 'edit' && (
                      <div className="p-4 border-t border-white/5">
                        <button onClick={addMfAction} className="flex items-center gap-2 text-xs font-bold text-[#cda632] hover:bg-[#cda632]/10 px-3 py-1.5 rounded transition-colors">
                          <Plus size={14} /> Add Action Row
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* SECTION 4: PROTECTION (Tabular as per Image) */}
                <div className="rounded-xl overflow-hidden border border-white/5 bg-[#0a1612]">
                  <div style={{ ...sectionHeaderStyle, background: "#232238", color: "#7f73d2" }}>Protection</div>
                  <div className="overflow-x-auto border-t border-white/5">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
                      <thead>
                        <tr>
                          <th style={{...thStyle, width: "20%"}}>Insurance Type</th>
                          <th style={{...thStyle, width: "20%"}}>Cover</th>
                          <th style={{...thStyle, width: "20%"}}>Range</th>
                          <th style={{...thStyle, width: "20%"}}>Suggestion</th>
                          <th style={{...thStyle, width: "20%"}}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { key: 'term', label: 'Term Plan' },
                          { key: 'health', label: 'Health Cover' },
                          { key: 'accident', label: 'Personal Accident' },
                          { key: 'emergency', label: 'Emergency Fund' }
                        ].map(row => (
                          <tr key={row.key} className="report-table-row">
                            <td style={{...tdStyle, fontWeight: 800}}>{row.label}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.cover || ""} onChange={e => setDoubleNested('protection', row.key, 'cover', e.target.value)} style={tInputStyle} /> : (planDraft.protection?.[row.key]?.cover || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.range || ""} onChange={e => setDoubleNested('protection', row.key, 'range', e.target.value)} style={tInputStyle} /> : (planDraft.protection?.[row.key]?.range || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.suggestion || ""} onChange={e => setDoubleNested('protection', row.key, 'suggestion', e.target.value)} style={tInputStyle} /> : (planDraft.protection?.[row.key]?.suggestion || "—")}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.remarks || ""} onChange={e => setDoubleNested('protection', row.key, 'remarks', e.target.value)} style={tInputStyle} /> : (planDraft.protection?.[row.key]?.remarks || "—")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SECTION 5: GOAL PLANNING (Tabular as per Image) */}
                <div className="rounded-xl overflow-hidden border border-white/5 bg-[#0a1612]">
                  <div style={{ ...sectionHeaderStyle, background: "#382315", color: "#c97736" }}>Goal Planning</div>
                  <div className="overflow-x-auto border-t border-white/5">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                      <thead>
                        <tr>
                          <th style={{...thStyle, width: "60px"}}>S No</th>
                          <th style={{...thStyle, width: "18%"}}>Your Goals</th>
                          <th style={thStyle}>Discussion</th>
                          <th style={thStyle}>Implementation</th>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>SIP</th>
                          <th style={thStyle}>Lump Sum</th>
                          <th style={thStyle}>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { key: "retirement", label: "Retirement Planning" },
                          { key: "education", label: "Children Education" },
                          { key: "marriage", label: "Children Marriage" },
                          { key: "house", label: "House Purchase" },
                          { key: "wealth", label: "Wealth Building" }
                        ].map((row, i) => {
                           const d = planDraft.goals?.[row.key] || {};
                           return (
                             <tr key={row.key} className="report-table-row">
                                <td style={{...tdStyle, color:"#889995"}}>{i+1}</td>
                                <td style={{...tdStyle, fontWeight: 800}}>{row.label}</td>
                                <td style={tdStyle}>{planMode === 'edit' ? (
                                  <select value={d.discussion || ""} onChange={e => setDoubleNested('goals', row.key, 'discussion', e.target.value)} style={tInputStyle}>
                                    <option value=""></option>{GOAL_DISCUSSIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                ) : (d.discussion || "—")}</td>
                                <td style={tdStyle}>{planMode === 'edit' ? (
                                  <select value={d.implementation || ""} onChange={e => setDoubleNested('goals', row.key, 'implementation', e.target.value)} style={tInputStyle}>
                                    <option value=""></option>{GOAL_IMPLEMENTATIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                ) : (d.implementation || "—")}</td>
                                <td style={tdStyle}>{planMode === 'edit' ? (
                                  <input type="date" value={toInputDate(d.date)} onChange={e => setDoubleNested('goals', row.key, 'date', toDisplayDate(e.target.value))} style={{...tInputStyle, color: "#fbbf24"}} />
                                ) : <span style={{ color: d.date ? "#fbbf24" : "#cda632" }}>{toDisplayDate(d.date) || "—"}</span>}</td>
                                <td style={tdStyle}>{planMode === 'edit' ? <input value={d.sip || ""} onChange={e => setDoubleNested('goals', row.key, 'sip', e.target.value)} style={tInputStyle} /> : (d.sip || "—")}</td>
                                <td style={tdStyle}>{planMode === 'edit' ? <input value={d.lump_sum || ""} onChange={e => setDoubleNested('goals', row.key, 'lump_sum', e.target.value)} style={tInputStyle} /> : (d.lump_sum || "—")}</td>
                                <td style={tdStyle}>{planMode === 'edit' ? <input value={d.due || ""} onChange={e => setDoubleNested('goals', row.key, 'due', e.target.value)} style={tInputStyle} /> : (d.due || "—")}</td>
                             </tr>
                           );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}