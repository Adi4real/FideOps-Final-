import { useState, useEffect, useRef } from "react";
import { Search, ChevronRight, ChevronDown, ChevronUp, Save, Plus, X, Clock, FileText, CheckCircle2, Filter, CalendarCheck, AlertTriangle, Star, Edit3, Download, Image as ImageIcon } from "lucide-react";
import { format, parseISO, addMonths, addYears, isBefore, isSameMonth, endOfMonth, startOfDay } from "date-fns";
import html2canvas from "html2canvas"; // <-- NEW IMPORT

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, orderBy, doc, updateDoc, arrayUnion } from "firebase/firestore";

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

export default function ClientReview() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [activeTab, setActiveTab] = useState("notes");

  // Filters State
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ rm: "", cycle: "", status: "due" });

  // States for Notes
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // States for Plan Modal (History & Editing)
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planMode, setPlanMode] = useState("view"); 
  const [activePlanId, setActivePlanId] = useState(null);
  const [planDraft, setPlanDraft] = useState(emptyPlan);
  const [savingPlan, setSavingPlan] = useState(false);
  const [exporting, setExporting] = useState(false); // Image export state
  
  const printRef = useRef(null); // Ref for image capture

  // Fetch Clients
  useEffect(() => {
    const clientsRef = collection(db, "clients");
    const q = query(clientsRef, orderBy("client_name"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const clientData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setClients(clientData);
      setLoading(false);
      
      setSelected(prev => {
        if (!prev) return null;
        const updatedSelected = clientData.find(c => c.id === prev.id);
        return updatedSelected || prev;
      });
    });
    return () => unsubscribe();
  }, []);

  const uniqueRMs = [...new Set(clients.map(c => c.rm_assigned).filter(v => v && v !== "-"))].sort();

  // Smart Filtering Logic
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
    }
    return matchesSearch && matchesRm && matchesCycle && matchesStatus;
  });

  const groupedClients = Object.values(filtered.reduce((acc, c) => {
    const key = c.client_name?.trim().toLowerCase() || "unknown";
    if (!acc[key]) acc[key] = { client_name: c.client_name || "Unknown", profiles: [] };
    acc[key].profiles.push(c);
    return acc;
  }, {})).sort((a, b) => a.client_name.localeCompare(b.client_name));

  const activeFilterCount = Object.values(filters).filter(v => v !== "" && v !== "all").length;

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

  // --- MODAL LOGIC & SAVING MULTIPLE PLANS ---
  const handleCreateNewPlan = () => {
    setPlanDraft(emptyPlan);
    setActivePlanId(null);
    setPlanMode("edit");
    setShowPlanModal(true);
  };

  const handleViewPlan = (plan) => {
    setPlanDraft(plan);
    setActivePlanId(plan.id);
    setPlanMode("view");
    setShowPlanModal(true);
  };

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
        newPlans.push({
          id: Date.now().toString(),
          date: format(new Date(), "yyyy-MM-dd"),
          ...planDraft
        });
      }
      await updateDoc(doc(db, "clients", selected.id), { review_plans: newPlans });
      setShowPlanModal(false);
    } catch (e) {
      console.error("Error saving plan:", e);
      alert("Failed to save plan. See console.");
    } finally { setSavingPlan(false); }
  };

  // --- HIGH RES IMAGE EXPORTER ---
  const handleDownloadImage = async () => {
    if (!printRef.current) return;
    setExporting(true);
    
    try {
      const element = printRef.current;
      // Temporarily expand height to capture everything that might be scrolling
      const originalHeight = element.style.height;
      const originalOverflow = element.style.overflow;
      element.style.height = 'auto';
      element.style.overflow = 'visible';

      const canvas = await html2canvas(element, {
        backgroundColor: '#0a1612', 
        scale: 2, 
        useCORS: true,
        logging: false,
      });
      
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${selected?.client_name.replace(/\s+/g, '_')}_Review.png`;
      link.href = dataUrl;
      link.click();

      // Restore styles
      element.style.height = originalHeight;
      element.style.overflow = originalOverflow;
    } catch (err) {
      console.error("Failed to export image", err);
      alert("Failed to generate image.");
    } finally {
      setExporting(false);
    }
  };

  // State Updates for Draft
  const setNested = (section, field, value) => { setPlanDraft(p => ({ ...p, [section]: { ...p[section], [field]: value } })); };
  const setDoubleNested = (section, item, field, value) => { setPlanDraft(p => ({ ...p, [section]: { ...p[section], [item]: { ...p[section][item], [field]: value } } })); };
  const addMfAction = () => { setPlanDraft(p => ({ ...p, mf_actions: [...(p.mf_actions || []), { fund: "", sip_increase: "", sip_cease: "", switch: "", redemption: "", action: "", suggestion: "", remarks: "" }] })); };
  const updateMfAction = (index, field, value) => { setPlanDraft(p => { const updated = [...p.mf_actions]; updated[index][field] = value; return { ...p, mf_actions: updated }; }); };
  const removeMfAction = (index) => { setPlanDraft(p => ({ ...p, mf_actions: p.mf_actions.filter((_, i) => i !== index) })); };

  // Styles
  const iStyle = { padding: "8px 12px", borderRadius: 8, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 13, width: "100%", outline: "none" };
  const thStyle = { padding: "10px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#889995", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" };
  const tdStyle = { padding: "6px", borderBottom: "1px solid rgba(255,255,255,0.02)" };
  const viewValStyle = { fontSize: 13, fontWeight: 600, color: "#fff", padding: "4px 0", minHeight: "24px" };
  const sectionHeader = { background: "rgba(255,255,255,0.05)", padding: "10px 14px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, color: "#c8d4d0", borderRadius: "8px 8px 0 0" };

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh", color: "var(--text-main)" }}>
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%); cursor: pointer; }
        input[type="date"] { color-scheme: dark; color: #fbbf24 !important; font-weight: 700; }
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#889995]" />
                <input className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-[#050a09] border border-white/10 text-white focus:border-[#4ade80] outline-none" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button onClick={() => setShowFilters(!showFilters)} className="px-3 rounded-xl border flex items-center justify-center transition-all hover:bg-white/5 relative" style={{ background: activeFilterCount > 0 ? "rgba(0,130,84,0.15)" : "#050a09", borderColor: activeFilterCount > 0 ? "#008254" : "var(--border)", color: activeFilterCount > 0 ? "#4ade80" : "#889995" }}>
                <Filter className="w-4 h-4" />
              </button>

              {showFilters && (
                <div className="absolute top-[110%] right-0 w-64 p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-top-2" style={{ background: "#0a1612", borderColor: "var(--border)", zIndex: 100 }}>
                  <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-white">Review Filters</p>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">Review Status</label>
                      <div className="flex bg-[#050a09] border border-white/10 rounded-lg overflow-hidden p-1">
                        <button onClick={() => setFilters({...filters, status: "due"})} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${filters.status === 'due' ? 'bg-[#fbbf24]/20 text-[#fbbf24]' : 'text-[#889995] hover:text-white'}`}>Due / Overdue</button>
                        <button onClick={() => setFilters({...filters, status: "all"})} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${filters.status === 'all' ? 'bg-white/10 text-white' : 'text-[#889995] hover:text-white'}`}>All Clients</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">RM Assigned</label>
                      <select value={filters.rm} onChange={e => setFilters({...filters, rm: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]">
                        <option value="">All RMs</option>
                        {uniqueRMs.map(rm => <option key={rm} value={rm}>{rm}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#889995] uppercase mb-1.5 block">Review Cycle</label>
                      <select value={filters.cycle} onChange={e => setFilters({...filters, cycle: e.target.value})} className="w-full bg-black border border-white/10 text-white text-xs rounded-lg p-2 outline-none focus:border-[#4ade80]">
                        <option value="">All Cycles</option>
                        {CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {filters.status === "due" && (
              <div className="mt-3 p-2 bg-[#fbbf24]/10 border border-[#fbbf24]/20 rounded-lg flex items-center justify-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[#fbbf24]" />
                <span className="text-[10px] font-bold text-[#fbbf24] uppercase tracking-wider">Showing Due / Overdue</span>
              </div>
            )}
          </div>
          
          <div className="overflow-y-auto flex-1 custom-scrollbar">
            {loading ? <div className="p-8 text-center text-sm text-[#889995]">Loading...</div> : 
             filtered.length === 0 ? <div className="p-8 text-center text-sm text-[#889995]">No reviews pending!</div> : 
             groupedClients.map(group => {
                const isMultiple = group.profiles.length > 1;
                const groupKey = group.client_name?.toLowerCase() || "unknown";
                const isExpanded = expandedGroup === groupKey;
                
                if (isMultiple) {
                  return (
                    <div key={groupKey} className="border-b border-white/5">
                      <button onClick={() => setExpandedGroup(isExpanded ? null : groupKey)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm bg-white/5 text-white/50">{group.client_name?.[0]?.toUpperCase() || "?"}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{group.client_name}</p>
                          <p className="text-[10px] text-[#4ade80] mt-0.5 font-bold uppercase">{group.profiles.length} Profiles</p>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                      </button>
                      {isExpanded && <div className="bg-black/40 pb-2">
                        {group.profiles.map(c => (
                          <button key={c.id} onClick={() => setSelected(c)} className={`w-full text-left py-2.5 pl-10 pr-4 flex items-center justify-between border-l-2 transition-colors ${selected?.id === c.id ? 'bg-[#008254]/10 border-[#4ade80]' : 'border-transparent hover:bg-white/5'}`}>
                            <span className="text-xs font-semibold text-[#c8d4d0] truncate">{c.tax_status && c.tax_status !== "-" ? c.tax_status : "Standard"}</span>
                            <ChevronRight className="w-3 h-3 text-white/30" />
                          </button>
                        ))}
                      </div>}
                    </div>
                  );
                } else {
                  const c = group.profiles[0];
                  const isActive = selected?.id === c.id;
                  let dueColor = "text-[#889995]";
                  if (c.next_review_date) {
                    const revDate = parseISO(c.next_review_date);
                    if (isBefore(revDate, startOfDay(new Date()))) dueColor = "text-[#f87171]"; // Overdue
                    else if (isSameMonth(revDate, new Date())) dueColor = "text-[#fbbf24]"; // Due this month
                  } else { dueColor = "text-[#fbbf24]"; }

                  return (
                    <button key={c.id} onClick={() => { setSelected(c); setExpandedGroup(null); }} className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-white/5 transition-colors ${isActive ? 'bg-[#008254]/10' : 'hover:bg-white/5'}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm ${isActive ? 'bg-[#4ade80] text-black' : 'bg-white/5 text-white/50'}`}>
                        {c.client_name?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate text-[#c8d4d0]">{c.client_name}</p>
                        <div className={`text-[10px] mt-0.5 font-bold flex items-center gap-1 ${dueColor}`}>
                          <Clock size={10} /> 
                          {c.next_review_date ? format(parseISO(c.next_review_date), "MMM yyyy") : "Unscheduled"}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/30" />
                    </button>
                  );
                }
              })
            }
          </div>
        </div>

        {/* Right Main Content */}
        <div className="lg:col-span-3 space-y-4">
          {!selected ? (
            <div className="rounded-2xl flex flex-col items-center justify-center min-h-[400px] text-center" style={{ background: "var(--glass)", border: "1px solid var(--border)" }}>
              <CalendarCheck className="w-12 h-12 mb-4 text-[#008254]" />
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
                <div className="flex gap-6 border-b border-white/10 mb-6">
                  <button onClick={() => setActiveTab('notes')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'notes' ? 'text-[#4ade80] border-b-2 border-[#4ade80]' : 'text-[#889995] hover:text-white'}`}>
                    <Clock className="w-4 h-4" /> Review Notes Log
                  </button>
                  <button onClick={() => setActiveTab('plan')} className={`pb-3 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'plan' ? 'text-[#4ade80] border-b-2 border-[#4ade80]' : 'text-[#889995] hover:text-white'}`}>
                    <FileText className="w-4 h-4" /> Document History
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
              </div>
            </>
          )}
        </div>
      </div>

      {/* MASSIVE MODAL FOR VIEW / EDIT PLAN */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-6xl bg-[#0a1612] border border-white/10 rounded-2xl flex flex-col max-h-[90vh] shadow-2xl relative overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-[#050a09] shrink-0">
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

            {/* Scrollable Body - Wrapped for Image Export */}
            <div className="overflow-y-auto flex-1 custom-scrollbar bg-black/40">
              <div ref={printRef} className="p-6 space-y-8 bg-[#0a1612]">
                
                {/* Clean Title only visible inside the image container */}
                {planMode === 'view' && (
                  <div className="text-center mb-6 pt-2 pb-6 border-b border-white/10">
                    <h1 className="text-2xl font-black text-white tracking-tight">{selected?.client_name} <span className="font-medium text-white/50">|</span> Portfolio Review Report</h1>
                    <p className="text-xs font-bold text-[#889995] mt-2 uppercase tracking-widest">
                      Report Generated: {planDraft.date ? format(parseISO(planDraft.date), "dd MMMM yyyy") : format(new Date(), "dd MMMM yyyy")}
                    </p>
                  </div>
                )}

                {/* SECTION 1: MF PORTFOLIO */}
                <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a1612]">
                  <div style={{ ...sectionHeader, background: "rgba(96, 165, 250, 0.15)", color: "#60a5fa" }}>Mutual Fund Portfolio</div>
                  <div className="p-4 grid grid-cols-2 md:grid-cols-6 gap-4">
                    {["Net Investment", "Current Value", "Gain", "SIP", "XIRR", "Remarks"].map((lbl, i) => {
                      const keys = ["net_investment", "current_value", "gain", "sip", "xirr", "remarks"];
                      return (
                        <div key={lbl}>
                          <label className="text-[9px] font-bold text-[#889995] uppercase block mb-1">{lbl}</label>
                          {planMode === 'edit' ? (
                            <input value={planDraft.portfolio?.[keys[i]] || ""} onChange={e => setNested('portfolio', keys[i], e.target.value)} style={iStyle} />
                          ) : (
                            <div style={viewValStyle}>{planDraft.portfolio?.[keys[i]] || "—"}</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* SECTION 2: SIP INCREASE */}
                <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a1612]">
                  <div style={{ ...sectionHeader, background: "rgba(232, 121, 249, 0.15)", color: "#e879f9" }}>SIP To Increase</div>
                  <div className="p-4">
                    {planMode === 'edit' ? (
                      <input placeholder="Enter amount or details..." value={planDraft.sip_increase || ""} onChange={e => setPlanDraft(p => ({...p, sip_increase: e.target.value}))} style={iStyle} />
                    ) : (
                      <div style={viewValStyle}>{planDraft.sip_increase || "—"}</div>
                    )}
                  </div>
                </div>

                {/* SECTION 3: MF ACTION */}
                <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a1612]">
                  <div style={{ ...sectionHeader, background: "rgba(251, 191, 36, 0.15)", color: "#fbbf24" }}>MF Action</div>
                  <div className="overflow-x-auto p-1">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
                      <thead>
                        <tr>
                          <th style={{...thStyle, width: "40px"}}>S No</th>
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
                          <tr key={i}>
                            <td style={{...tdStyle, textAlign:"center", fontSize:11, color:"#889995"}}>{i+1}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.fund} onChange={e => updateMfAction(i, 'fund', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.fund || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.sip_increase} onChange={e => updateMfAction(i, 'sip_increase', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.sip_increase || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.sip_cease} onChange={e => updateMfAction(i, 'sip_cease', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.sip_cease || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.switch} onChange={e => updateMfAction(i, 'switch', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.switch || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.redemption} onChange={e => updateMfAction(i, 'redemption', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.redemption || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.action} onChange={e => updateMfAction(i, 'action', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.action || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.suggestion} onChange={e => updateMfAction(i, 'suggestion', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.suggestion || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={act.remarks} onChange={e => updateMfAction(i, 'remarks', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{act.remarks || "—"}</div>}</td>
                            {planMode === 'edit' && (
                              <td style={tdStyle}><button onClick={() => removeMfAction(i)} className="text-red-400 hover:bg-red-400/20 p-1.5 rounded transition-colors"><X size={14}/></button></td>
                            )}
                          </tr>
                        )) : (
                          <tr><td colSpan={planMode === 'edit' ? 10 : 9} style={{...tdStyle, textAlign:"center", color:"#889995", fontStyle:"italic", padding:"20px"}}>No MF actions recorded.</td></tr>
                        )}
                      </tbody>
                    </table>
                    {planMode === 'edit' && (
                      <button onClick={addMfAction} className="flex items-center gap-2 text-xs font-bold text-[#fbbf24] mt-3 ml-3 hover:bg-[#fbbf24]/10 px-3 py-1.5 rounded transition-colors">
                        <Plus size={14} /> Add Row
                      </button>
                    )}
                  </div>
                </div>

                {/* SECTION 4: PROTECTION */}
                <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a1612]">
                  <div style={{ ...sectionHeader, background: "rgba(167, 139, 250, 0.15)", color: "#a78bfa" }}>Protection</div>
                  <div className="overflow-x-auto p-1">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px" }}>
                      <thead>
                        <tr>
                          <th style={{...thStyle, width:"180px"}}>Insurance Type</th>
                          <th style={thStyle}>Cover</th>
                          <th style={thStyle}>Range</th>
                          <th style={thStyle}>Suggestion</th>
                          <th style={thStyle}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { key: "term", label: "Term Plan" },
                          { key: "health", label: "Health Cover" },
                          { key: "accident", label: "Personal Accident" },
                          { key: "emergency", label: "Emergency Fund" }
                        ].map((row) => (
                          <tr key={row.key}>
                            <td style={{...tdStyle, fontSize:12, fontWeight:700, color:"#c8d4d0"}}>{row.label}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.cover || ""} onChange={e => setDoubleNested('protection', row.key, 'cover', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.protection?.[row.key]?.cover || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.range || ""} onChange={e => setDoubleNested('protection', row.key, 'range', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.protection?.[row.key]?.range || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.suggestion || ""} onChange={e => setDoubleNested('protection', row.key, 'suggestion', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.protection?.[row.key]?.suggestion || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.protection?.[row.key]?.remarks || ""} onChange={e => setDoubleNested('protection', row.key, 'remarks', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.protection?.[row.key]?.remarks || "—"}</div>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SECTION 5: GOAL PLANNING */}
                <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a1612]">
                  <div style={{ ...sectionHeader, background: "rgba(251, 146, 60, 0.15)", color: "#fb923c" }}>Goal Planning</div>
                  <div className="overflow-x-auto p-1">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
                      <thead>
                        <tr>
                          <th style={{...thStyle, width:"40px"}}>S No</th>
                          <th style={{...thStyle, width:"180px"}}>Your Goals</th>
                          <th style={thStyle}>Discussion</th>
                          <th style={thStyle}>Implementation</th>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>SIP</th>
                          <th style={thStyle}>Lump sum</th>
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
                        ].map((row, i) => (
                          <tr key={row.key}>
                            <td style={{...tdStyle, textAlign:"center", fontSize:11, color:"#889995"}}>{i+1}</td>
                            <td style={{...tdStyle, fontSize:12, fontWeight:700, color:"#c8d4d0"}}>{row.label}</td>
                            
                            <td style={tdStyle}>
                              {planMode === 'edit' ? (
                                <select value={planDraft.goals?.[row.key]?.discussion || ""} onChange={e => setDoubleNested('goals', row.key, 'discussion', e.target.value)} style={iStyle}>
                                  <option value=""></option>
                                  {GOAL_DISCUSSIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : <div style={viewValStyle}>{planDraft.goals?.[row.key]?.discussion || "—"}</div>}
                            </td>
                            
                            <td style={tdStyle}>
                              {planMode === 'edit' ? (
                                <select value={planDraft.goals?.[row.key]?.implementation || ""} onChange={e => setDoubleNested('goals', row.key, 'implementation', e.target.value)} style={iStyle}>
                                  <option value=""></option>
                                  {GOAL_IMPLEMENTATIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : <div style={viewValStyle}>{planDraft.goals?.[row.key]?.implementation || "—"}</div>}
                            </td>
                            
                            <td style={tdStyle}>
                              {planMode === 'edit' ? (
                                <input type="date" value={planDraft.goals?.[row.key]?.date || ""} onChange={e => setDoubleNested('goals', row.key, 'date', e.target.value)} style={{...iStyle, color: "#fbbf24"}} />
                              ) : <div style={{...viewValStyle, color: "#fbbf24"}}>{planDraft.goals?.[row.key]?.date ? format(parseISO(planDraft.goals?.[row.key]?.date), "dd MMM yyyy") : "—"}</div>}
                            </td>
                            
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.goals?.[row.key]?.sip || ""} onChange={e => setDoubleNested('goals', row.key, 'sip', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.goals?.[row.key]?.sip || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.goals?.[row.key]?.lump_sum || ""} onChange={e => setDoubleNested('goals', row.key, 'lump_sum', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.goals?.[row.key]?.lump_sum || "—"}</div>}</td>
                            <td style={tdStyle}>{planMode === 'edit' ? <input value={planDraft.goals?.[row.key]?.due || ""} onChange={e => setDoubleNested('goals', row.key, 'due', e.target.value)} style={iStyle} /> : <div style={viewValStyle}>{planDraft.goals?.[row.key]?.due || "—"}</div>}</td>
                          </tr>
                        ))}
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