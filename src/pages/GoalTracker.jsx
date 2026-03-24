import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Plus, X, Pencil, Trash2, FileSpreadsheet, CalendarClock, Users, AlertCircle, Save, Info, Target, Clock, Image as ImageIcon, Globe, Mail, Phone, Facebook, Instagram, Twitter, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { format, parseISO, addYears } from "date-fns";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import html2canvas from "html2canvas";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, doc, updateDoc } from "firebase/firestore";

const GOAL_TYPES = ["Children Marriage", "UG Education", "PG Education", "Home Purchase", "Retirement", "Wealth Creation", "Custom..."];
const RM_LIST = ["Ujjwal", "Manny", "Uday", "Joel", "Prince", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel"];

// --- HELPER: Number to Words ---
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

// --- GLOBAL MEMORY CACHE ---
let cachedClients = [];
let isListeningClients = false;
let clientSubs = new Set();

export default function GoalTracker() {
  const [clients, setClients] = useState(cachedClients);
  const [loading, setLoading] = useState(cachedClients.length === 0);

  // Filters
  const [search, setSearch] = useState("");
  const [filterAssigned, setFilterAssigned] = useState("All");
  const [reviewYears, setReviewYears] = useState("");

  // Modals & Export
  const [showForm, setShowForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [activeGoal, setActiveGoal] = useState(null);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef(null);

  // Form State
  const [draft, setDraft] = useState({
    id: "", clientId: "", clientName: "", date: format(new Date(), "yyyy-MM-dd"),
    goalType: "Retirement", customGoal: "", assigned: [],
    pv: 1000000, years: 10, reviewN: 2, inf: 6, growth: 12,
    strategyType: "SIP", 
    investments: [{ type: "SIP", amount: 0, fund: "" }],
    risk: "Medium", status: "Active", notes: ""
  });

  const [clientSearchText, setClientSearchText] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  // Fetch Clients
  useEffect(() => {
    clientSubs.add(setClients);
    if (!isListeningClients) {
      isListeningClients = true;
      const q = query(collection(db, "clients"));
      onSnapshot(q, (snapshot) => {
        cachedClients = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        clientSubs.forEach(cb => cb(cachedClients));
        setLoading(false);
      });
    } else { setLoading(false); }
    
    return () => { 
        clientSubs.delete(setClients); 
    };
  }, []);

  // Extract all goals
  const allGoals = useMemo(() => {
    return clients.flatMap(c => 
      (c.financial_goals || []).map(g => ({ ...g, clientId: c.id, clientName: c.client_name }))
    );
  }, [clients]);

  // --- FILTERING ---
  const filteredGoals = useMemo(() => {
    const today = new Date();
    let res = allGoals.filter(g => {
      const cName = g.clientName || "";
      const gType = g.goalType || "";
      const q = search.toLowerCase();
      return cName.toLowerCase().includes(q) || gType.toLowerCase().includes(q);
    });
    
    if (filterAssigned !== "All") {
      res = res.filter(g => (g.assigned || []).includes(filterAssigned));
    }

    if (reviewYears !== "" && !isNaN(Number(reviewYears))) {
      const horizon = new Date();
      horizon.setFullYear(today.getFullYear() + Number(reviewYears));
      res = res.filter(g => {
        const target = addYears(parseISO(g.date), Number(g.years) || 0);
        const reviewStart = new Date(target);
        reviewStart.setFullYear(reviewStart.getFullYear() - (Number(g.reviewN) || 2));
        return reviewStart <= horizon && g.status !== "Completed";
      });
    }
    
    return res.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [allGoals, search, filterAssigned, reviewYears]);

  // --- MATH ENGINE ---
  const calculateMath = (data) => {
    const pv = parseFloat(data.pv) || 0;
    const years = parseFloat(data.years) || 0;
    const inf = parseFloat(data.inf) / 100 || 0;
    const growth = parseFloat(data.growth) / 100 || 0;

    const goalFV = pv * Math.pow((1 + inf), years);
    const r = growth > 0 ? Math.pow((1 + growth), 1/12) - 1 : 0;
    const n = years * 12;
    const af = (n > 0 && r > 0) ? ((Math.pow(1 + r, n) - 1) / r) * (1 + r) : n;

    const reqSIP = (n > 0) ? goalFV / af : 0;
    const reqLS = goalFV / Math.pow((1 + growth), years);

    let totalSIP = 0, totalLS = 0;
    (data.investments || []).forEach(inv => {
      const amt = parseFloat(inv.amount) || 0;
      if (inv.type === "SIP") totalSIP += amt; else totalLS += amt;
    });

    const sipMaturity = totalSIP * af;
    const lsMaturity = totalLS * Math.pow((1 + growth), years);
    const projectedMaturity = sipMaturity + lsMaturity;

    const gap = goalFV - projectedMaturity;
    const deficitSip = gap > 0 && n > 0 ? gap / af : 0;
    const deficitLs = gap > 0 ? gap / Math.pow((1 + growth), years) : 0;

    let displayStrategy = "NONE";
    if (data.strategyType === "SIP_LS") displayStrategy = "SIP + LS";
    else if (data.strategyType === "SIP") displayStrategy = "SIP ONLY";
    else if (data.strategyType === "LS") displayStrategy = "LS ONLY";

    return { goalFV, reqSIP, reqLS, totalSIP, totalLS, sipMaturity, lsMaturity, projectedMaturity, gap, deficitSip, deficitLs, displayStrategy };
  };

  // --- ACTIONS ---
  const openNewForm = () => {
    setClientSearchText("");
    setDraft({
      id: "", clientId: "", clientName: "", date: format(new Date(), "yyyy-MM-dd"),
      goalType: "Retirement", customGoal: "", assigned: [],
      pv: 1000000, years: 10, reviewN: 2, inf: 6, growth: 12,
      strategyType: "SIP",
      investments: [{ type: "SIP", amount: 0, fund: "" }],
      risk: "Medium", status: "Active", notes: ""
    });
    setShowForm(true);
  };

  const openEditForm = (goal) => {
    const isCustom = !GOAL_TYPES.includes(goal.goalType) && goal.goalType;
    setClientSearchText(goal.clientName || "");
    setDraft({
      ...goal,
      goalType: isCustom ? "Custom..." : goal.goalType,
      customGoal: isCustom ? goal.goalType : "",
      strategyType: goal.strategyType || "SIP"
    });
    setShowForm(true);
  };

  const handleStrategyChange = (newStrategy) => {
    const updatedInvestments = draft.investments.map(inv => ({
      ...inv, type: newStrategy === "SIP_LS" ? inv.type : newStrategy
    }));
    setDraft({ ...draft, strategyType: newStrategy, investments: updatedInvestments });
  };

  const handleSaveGoal = async (e) => {
    e.preventDefault();
    if (!draft.clientId) return alert("Please select a valid client from the dropdown.");

    try {
      const client = clients.find(c => c.id === draft.clientId);
      const existingGoals = client.financial_goals || [];
      let updatedGoals = [...existingGoals];
      
      const finalGoalType = draft.goalType === "Custom..." ? draft.customGoal : draft.goalType;
      const goalToSave = { ...draft, goalType: finalGoalType };
      delete goalToSave.clientName; 
      delete goalToSave.clientId;

      if (draft.id) {
        const idx = updatedGoals.findIndex(g => g.id === draft.id);
        if (idx > -1) updatedGoals[idx] = goalToSave;
      } else {
        goalToSave.id = Date.now().toString();
        updatedGoals.push(goalToSave);
      }

      await updateDoc(doc(db, "clients", client.id), { financial_goals: updatedGoals });
      setShowForm(false);
    } catch (err) { console.error("Error saving goal:", err); alert("Failed to save goal."); }
  };

  const handleDeleteGoal = async (goal) => {
    if (!window.confirm(`Permanently delete ${goal.goalType} for ${goal.clientName}?`)) return;
    try {
      const client = clients.find(c => c.id === goal.clientId);
      const updatedGoals = (client.financial_goals || []).filter(g => g.id !== goal.id);
      await updateDoc(doc(db, "clients", goal.clientId), { financial_goals: updatedGoals });
      if (showPreview) setShowPreview(false);
    } catch (err) { console.error(err); }
  };

  const handleExportExcel = () => {
    if (!window.XLSX) return alert("Excel library not loaded.");
    const ws = window.XLSX.utils.json_to_sheet(filteredGoals.map(g => {
      const m = calculateMath(g);
      return {
        "Client Name": g.clientName, "Goal": g.goalType, "Date": g.date, "Status": g.status,
        "Risk": g.risk, "Staff": (g.assigned||[]).join(", "), "Strategy": m.displayStrategy,
        "Present Cost": g.pv, "Term (Yrs)": g.years, "Inflation %": g.inf, "Growth %": g.growth,
        "Future Value": Math.round(m.goalFV), "Target Date": format(addYears(parseISO(g.date), Number(g.years) || 0), "MMM yyyy"),
        "Req SIP": Math.round(m.reqSIP), "Req LS": Math.round(m.reqLS),
        "Actual SIP": m.totalSIP, "Actual LS": m.totalLS, "Projected Maturity": Math.round(m.projectedMaturity),
        "Gap": Math.round(m.gap)
      };
    }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Goals");
    window.XLSX.writeFile(wb, "FideloWealth_Goals.xlsx");
  };

  const handleDownloadImage = async () => {
    if (!printRef.current) return;
    setExporting(true);
    
    try {
      const element = printRef.current;
      const originalWidth = element.style.width;
      const originalHeight = element.style.height;
      const originalOverflow = element.style.overflow;
      
      element.style.width = '1050px'; 
      element.style.height = 'auto';
      element.style.overflow = 'visible';

      await new Promise(resolve => setTimeout(resolve, 200));

      const canvas = await html2canvas(element, {
        backgroundColor: '#0a1110', 
        scale: 2, 
        useCORS: true,
        logging: false,
        windowWidth: 1050
      });
      
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${activeGoal?.clientName.replace(/\s+/g, '_')}_Goal_Plan.png`;
      link.href = dataUrl;
      link.click();

      element.style.width = originalWidth;
      element.style.height = originalHeight;
      element.style.overflow = originalOverflow;
    } catch (err) {
      console.error("Failed to export image", err);
      alert("Failed to generate image.");
    } finally {
      setExporting(false);
    }
  };

  const today = new Date();
  let pendingReviews = 0;
  filteredGoals.forEach(g => {
    const target = addYears(parseISO(g.date), Number(g.years) || 0);
    const reviewStart = new Date(target); reviewStart.setFullYear(reviewStart.getFullYear() - (Number(g.reviewN) || 2));
    if (today >= reviewStart && today <= target && g.status !== "Completed") pendingReviews++;
  });

  const liveMath = calculateMath(draft);

  // Common Form Input Classes
  const inputClass = "w-full bg-[#050a09] border border-white/10 p-3 rounded-xl text-white text-sm focus:border-[#008254] focus:ring-1 focus:ring-[#008254] transition-all outline-none placeholder-[#889995]";
  const labelClass = "block text-[10px] font-bold text-[#889995] uppercase mb-2 tracking-wide";

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black)", minHeight: "100vh", color: "var(--text-main)" }}>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%); cursor: pointer; }
        
        .pill { padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
        .pill-High { background: rgba(220, 38, 38, 0.2); color: #f87171; }
        .pill-Medium { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
        .pill-Low { background: rgba(0, 130, 84, 0.2); color: #4ade80; }
        
        .status-Active { background: rgba(0, 130, 84, 0.2); color: #4ade80; }
        .status-Completed { background: rgba(0, 120, 255, 0.2); color: #60a5fa; }
        .status-Paused { background: rgba(100, 116, 139, 0.2); color: #cbd5e1; }
        
        .table-th { padding: 16px 10px; color: var(--text-muted); text-align: center; font-weight: 700; background: rgba(255,255,255,0.02); text-transform: uppercase; letter-spacing: 1px; font-size: 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .table-td { padding: 14px 10px; border-bottom: 1px solid var(--border); text-align: center; font-size: 12px; }
        .amt-stack { display: flex; flex-direction: column; gap: 2px; align-items: center; font-weight: 700; line-height: 1.2; }
        .amt-sub { font-size: 10px; color: var(--text-muted); border-top: 1px solid var(--border); width: 100%; padding-top: 2px; margin-top: 2px; }
      `}</style>

      {/* HEADER & FILTERS */}
      <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[24px] p-6 md:p-8 backdrop-blur-md">
        <div className="flex flex-col md:flex-row justify-between gap-6 mb-8 border-b border-white/10 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#008254]/20 flex items-center justify-center text-[#4ade80]"><CalendarClock size={24}/></div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-wide">Financial Goal Planner</h1>
              <p className="text-sm text-[#889995] font-medium mt-1">Map out client futures and required investments.</p>
            </div>
          </div>
          {pendingReviews > 0 && (
            <div className="flex items-center gap-2 bg-[#fbbf24]/10 border border-[#fbbf24]/30 px-4 py-2 rounded-full h-fit animate-pulse">
              <AlertCircle size={16} className="text-[#fbbf24]" />
              <span className="text-xs font-bold text-[#fbbf24] uppercase tracking-wider">{pendingReviews} PLAN REVIEW REQUIRED</span>
            </div>
          )}
        </div>

        {/* --- FIXED: FLEXBOX LAYOUT FOR SEARCH & FILTERS --- */}
        <div className="flex flex-col xl:flex-row gap-4 items-stretch xl:items-center w-full">
          
          {/* Left: Main Search (Takes up remaining space) */}
          <div className="flex-1 flex items-center bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 h-[52px] focus-within:border-[#008254] transition-colors shadow-inner">
            <Search size={18} className="text-[#889995] mr-3 shrink-0" />
            <input 
              type="text" 
              placeholder="Search client name or goal..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              className="bg-transparent border-none text-white w-full outline-none text-sm placeholder-[#889995]" 
            />
          </div>

          {/* Right: Filters & Actions */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center shrink-0">
            
            {/* Review Years Filter */}
            <div className="w-full sm:w-44 flex items-center bg-[var(--glass)] border border-[var(--border)] rounded-xl px-4 h-[52px] focus-within:border-[#fbbf24] transition-colors">
              <CalendarClock size={16} className="text-[#fbbf24] mr-3 shrink-0" />
              <input 
                type="number" 
                placeholder="Due in (Yrs)..." 
                value={reviewYears} 
                onChange={e => setReviewYears(e.target.value)} 
                className="bg-transparent border-none text-[#fbbf24] font-bold text-sm w-full outline-none placeholder-[#889995]/70" 
              />
            </div>

            {/* Staff Filter */}
            <div className="w-full sm:w-44 flex items-center bg-[var(--glass)] border border-[var(--border)] rounded-xl px-4 h-[52px] focus-within:border-[#008254] transition-colors">
              <Users size={16} className="text-[#889995] mr-3 shrink-0" />
              <select 
                value={filterAssigned} 
                onChange={e => setFilterAssigned(e.target.value)} 
                className="bg-transparent border-none text-white w-full outline-none text-sm font-medium cursor-pointer"
              >
                <option value="All">All Staff</option>
                {RM_LIST.map(s => <option key={s} value={s} className="bg-[#0a1612]">{s}</option>)}
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 w-full sm:w-auto">
              <button 
                onClick={handleExportExcel} 
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[var(--glass)] border border-[var(--border)] hover:border-[#008254] px-5 h-[52px] rounded-xl text-sm font-bold text-white transition-all whitespace-nowrap"
              >
                <FileSpreadsheet size={18} /> EXCEL
              </button>
              <button 
                onClick={openNewForm} 
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#008254] hover:bg-[#00a369] px-6 h-[52px] rounded-xl text-sm font-bold text-white transition-all shadow-[0_4px_15px_rgba(0,130,84,0.3)] whitespace-nowrap"
              >
                <Plus size={18} /> NEW PLAN
              </button>
            </div>
            
          </div>
        </div>
      </div>

      {/* MASTER TABLE */}
      <div className="w-full bg-[var(--glass)] border border-[var(--border)] rounded-[20px] backdrop-blur-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="table-th">#</th><th className="table-th">PLAN DATE</th><th className="table-th text-left pl-4">CLIENT NAME</th>
                <th className="table-th">GOAL</th><th className="table-th">RISK</th><th className="table-th">STAFF</th><th className="table-th">TYPE</th>
                <th className="table-th">PV</th><th className="table-th">TERM</th><th className="table-th">INF</th><th className="table-th">GRW</th>
                <th className="table-th">TARGET FV</th><th className="table-th">TARGET DATE</th><th className="table-th">REQ. INV</th>
                <th className="table-th">ACTUAL</th><th className="table-th">GAP</th><th className="table-th">STATUS</th><th className="table-th">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={18} className="text-center py-10 text-[#889995]">Loading goals...</td></tr>
              ) : filteredGoals.length === 0 ? (
                <tr><td colSpan={18} className="text-center py-10 text-[#889995]">No goals found.</td></tr>
              ) : (
                filteredGoals.map((g, index) => {
                  const targetDate = addYears(parseISO(g.date), Number(g.years) || 0);
                  const reviewStart = new Date(targetDate); reviewStart.setFullYear(reviewStart.getFullYear() - (Number(g.reviewN) || 2));
                  const isReviewing = today >= reviewStart && today <= targetDate && g.status !== "Completed";
                  const m = calculateMath(g);

                  return (
                    <tr key={g.id} className="hover:bg-white/5 transition-colors" style={{ background: isReviewing ? "rgba(251, 191, 36, 0.05)" : "transparent" }}>
                      <td className="table-td">{index + 1}</td>
                      <td className="table-td">{g.date}</td>
                      <td className="table-td text-left pl-4 font-bold text-white cursor-pointer hover:text-[#4ade80]" onClick={() => { setActiveGoal(g); setShowPreview(true); }}>{g.clientName}</td>
                      <td className="table-td text-white/80">{g.goalType}</td>
                      <td className="table-td"><span className={`pill pill-${g.risk}`}>{g.risk}</span></td>
                      <td className="table-td"><div className="amt-stack text-[9px] text-[#889995]">{(g.assigned || []).map(n => <span key={n}>{n}</span>)}</div></td>
                      <td className="table-td font-bold text-white">{m.displayStrategy}</td>
                      <td className="table-td">₹{Number(g.pv).toLocaleString()}</td>
                      <td className="table-td">{g.years}Y</td>
                      <td className="table-td">{g.inf}%</td>
                      <td className="table-td">{g.growth}%</td>
                      <td className="table-td font-bold text-[#fbbf24]">₹{Math.round(m.goalFV).toLocaleString()}</td>
                      <td className="table-td">{format(targetDate, "MMM yyyy")}</td>
                      <td className="table-td"><div className="amt-stack"><span>₹{Math.round(m.reqSIP).toLocaleString()}</span><span className="amt-sub">₹{Math.round(m.reqLS).toLocaleString()}</span></div></td>
                      <td className="table-td"><div className="amt-stack"><span className="text-[#4ade80]">₹{Math.round(m.totalSIP).toLocaleString()}</span><span className="amt-sub">₹{Math.round(m.totalLS).toLocaleString()}</span></div></td>
                      <td className={`table-td font-bold ${m.gap <= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>₹{Math.round(Math.abs(m.gap)).toLocaleString()}</td>
                      <td className="table-td"><span className={`pill ${isReviewing ? 'status-Review bg-[#fbbf24]/20 text-[#fbbf24]' : `status-${g.status}`}`}>{isReviewing ? 'Under Review' : g.status}</span></td>
                      <td className="table-td">
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => openEditForm(g)} className="text-[#60a5fa] hover:scale-110"><Pencil size={16}/></button>
                          <button onClick={() => handleDeleteGoal(g)} className="text-[#f87171] hover:scale-110"><Trash2 size={16}/></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 text-[11px] font-bold text-[#889995] tracking-widest border-t border-white/10 bg-black/20">
          {filteredGoals.length.toString().padStart(2, '0')} PLANS INDEXED
        </div>
      </div>

      {/* --- RE-DESIGNED 2-COLUMN FORM OVERLAY --- */}
      {showForm && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="w-full max-w-7xl bg-[#0a1110] border border-white/10 rounded-[24px] flex flex-col h-full max-h-[92vh] shadow-[0_20px_80px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-300 overflow-hidden relative">
            
            {/* 2-Column Layout */}
            <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
              
              {/* LEFT: FORM (Scrollable) */}
              <div className="flex-1 lg:w-[65%] overflow-y-auto custom-scrollbar p-6 md:p-10 space-y-10 bg-[#0a1110]">
                
                {/* NEW TITLE PLACEMENT */}
                <div className="flex items-center gap-5 pb-4">
                  <div className="w-14 h-14 rounded-2xl bg-[#008254]/20 flex items-center justify-center text-[#4ade80] shrink-0">
                    <Target size={28}/>
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-white tracking-tight">Goal Planning Worksheet</h2>
                    <p className="text-sm font-medium text-[#889995] mt-1">{draft.id ? "Edit existing financial goal" : "Configure a new financial plan"}</p>
                  </div>
                </div>
                
                {/* Section 1: Client Info */}
                <div className="space-y-5">
                  <h3 className="text-xs font-black text-[#008254] uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-2">
                    <Users size={14}/> 1. Client & Goal Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="relative">
                      <label className={labelClass}>Client Name *</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#889995]" />
                        <input 
                          placeholder="Search Client..." 
                          value={clientSearchText} 
                          onFocus={() => setShowClientDropdown(true)} 
                          onChange={e => {
                            setClientSearchText(e.target.value);
                            setShowClientDropdown(true);
                            setDraft({...draft, clientId: "", clientName: ""}); 
                          }} 
                          className={`${inputClass} pl-10`}
                          required 
                        />
                        {showClientDropdown && clientSearchText && (
                          <div className="absolute top-[100%] left-0 right-0 bg-[#0a1612] border border-[#008254] rounded-xl mt-2 z-50 max-h-[250px] overflow-y-auto shadow-2xl custom-scrollbar" onMouseLeave={() => setShowClientDropdown(false)}>
                            {clients.filter(c => c.client_name?.toLowerCase().includes(clientSearchText.toLowerCase())).map(c => (
                              <div key={c.id} onClick={() => { setClientSearchText(c.client_name); setDraft({...draft, clientId: c.id, clientName: c.client_name, assigned: c.rm_assigned ? [c.rm_assigned] : [] }); setShowClientDropdown(false); }} className="p-3 text-sm font-medium text-white hover:bg-[#008254] cursor-pointer border-b border-white/5">
                                {c.client_name} {c.client_code ? <span className="text-xs text-[#4ade80] ml-2 font-bold">({c.client_code})</span> : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Plan Date</label>
                      <input type="date" value={draft.date} onChange={e => setDraft({...draft, date: e.target.value})} className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Goal Type</label>
                      <select value={draft.goalType} onChange={e => setDraft({...draft, goalType: e.target.value})} className={inputClass}>
                        {GOAL_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                      {draft.goalType === "Custom..." && (
                        <input placeholder="Specify custom goal..." value={draft.customGoal} onChange={e => setDraft({...draft, customGoal: e.target.value})} className={`${inputClass} mt-3 border-[#fbbf24]/50`} required />
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 2: Assumptions */}
                <div className="space-y-5">
                  <h3 className="text-xs font-black text-[#008254] uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-2">
                    <Target size={14}/> 2. Financial Assumptions
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                    <div className="col-span-2">
                      <label className={labelClass}>Present Cost (₹)</label>
                      <input type="number" value={draft.pv} onChange={e => setDraft({...draft, pv: e.target.value})} className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Term (Yrs)</label>
                      <input type="number" value={draft.years} onChange={e => setDraft({...draft, years: e.target.value})} className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Review In (Yrs)</label>
                      <input type="number" value={draft.reviewN} onChange={e => setDraft({...draft, reviewN: e.target.value})} className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Inflation (%)</label>
                      <input type="number" value={draft.inf} onChange={e => setDraft({...draft, inf: e.target.value})} className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Growth (%)</label>
                      <input type="number" value={draft.growth} onChange={e => setDraft({...draft, growth: e.target.value})} className={inputClass} required />
                    </div>
                  </div>
                </div>

                {/* Section 3: Deployment Strategy */}
                <div className="space-y-5">
                  <h3 className="text-xs font-black text-[#008254] uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-2">
                    <TrendingUp size={14}/> 3. Deployment Strategy
                  </h3>
                  
                  <div className="w-full md:w-1/2">
                    <label className={labelClass}>Investment Mode</label>
                    <select value={draft.strategyType} onChange={e => handleStrategyChange(e.target.value)} className={`${inputClass} border-[#008254]/50`}>
                      <option value="SIP">Monthly SIP Only</option>
                      <option value="LS">Lump Sum Only</option>
                      <option value="SIP_LS">SIP + Lump Sum Hybrid</option>
                    </select>
                  </div>

                  {/* Sub-Investments Rows */}
                  <div className="space-y-3 pt-2">
                    {draft.investments.map((inv, i) => (
                      <div key={i} className="flex items-center gap-3 bg-[#050a09] border border-white/5 p-2 rounded-2xl group hover:border-white/20 transition-all">
                        <select 
                          value={inv.type} 
                          disabled={draft.strategyType !== "SIP_LS"} 
                          onChange={e => { const n = [...draft.investments]; n[i].type = e.target.value; setDraft({...draft, investments: n}); }} 
                          className="w-[90px] shrink-0 bg-[#0a1612] border border-white/10 p-3 rounded-xl text-white text-xs font-bold focus:border-[#008254] outline-none disabled:opacity-50"
                        >
                          <option value="SIP">SIP</option>
                          <option value="LS">Lump Sum</option>
                        </select>
                        
                        <input 
                          placeholder="Fund / Scheme Name" 
                          value={inv.fund || ""} 
                          onChange={e => { const n = [...draft.investments]; n[i].fund = e.target.value; setDraft({...draft, investments: n}); }} 
                          className="flex-1 bg-[#0a1612] border border-white/10 p-3 rounded-xl text-white text-sm focus:border-[#008254] outline-none transition-colors" 
                        />
                        
                        <div className="relative w-[160px] shrink-0">
                          <input 
                            type="number" 
                            placeholder="Amount (₹)" 
                            value={inv.amount || ""} 
                            onChange={e => { const n = [...draft.investments]; n[i].amount = e.target.value; setDraft({...draft, investments: n}); }} 
                            className="w-full bg-[#0a1612] border border-white/10 p-3 rounded-xl text-white text-sm focus:border-[#008254] outline-none" 
                          />
                          {inv.amount && <p className="text-[9px] text-[#4ade80] mt-1 ml-1 italic font-bold absolute">{numberToWords(inv.amount)}</p>}
                        </div>

                        <button 
                          type="button" 
                          onClick={() => { const n = draft.investments.filter((_, idx) => idx !== i); setDraft({...draft, investments: n}); }} 
                          disabled={draft.investments.length === 1} 
                          className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-10 shrink-0 transition-all"
                        >
                          <X size={16}/>
                        </button>
                      </div>
                    ))}
                    
                    <button type="button" onClick={() => setDraft({...draft, investments: [...draft.investments, {type: draft.strategyType === "LS" ? "LS" : "SIP", amount: 0, fund: ""}]})} className="flex items-center gap-1.5 text-xs font-black text-[#008254] hover:text-[#4ade80] py-2 transition-colors uppercase tracking-wider">
                      <Plus size={14}/> Add Another Fund
                    </button>
                  </div>
                </div>

                {/* Section 4: Settings */}
                <div className="space-y-5 pb-10">
                  <h3 className="text-xs font-black text-[#008254] uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-2">
                    <Info size={14}/> 4. Plan Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className={labelClass}>Risk Appetite</label>
                      <select value={draft.risk} onChange={e => setDraft({...draft, risk: e.target.value})} className={inputClass}>
                        <option value="Low">Low Risk</option>
                        <option value="Medium">Medium Risk</option>
                        <option value="High">High Risk</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Status</label>
                      <select value={draft.status} onChange={e => setDraft({...draft, status: e.target.value})} className={inputClass}>
                        <option value="Active">Active</option>
                        <option value="Under-Review">Under Review</option>
                        <option value="Paused">Paused</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Assigned Staff</label>
                      <select value={draft.assigned[0] || ""} onChange={e => setDraft({...draft, assigned: [e.target.value]})} className={inputClass}>
                        <option value="">Select RM...</option>
                        {RM_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Admin Notes</label>
                      <textarea placeholder="Optional remarks..." value={draft.notes} onChange={e => setDraft({...draft, notes: e.target.value})} className={`${inputClass} resize-none h-[46px]`} />
                    </div>
                  </div>
                </div>

              </div>

              {/* RIGHT: SUMMARY (Fixed/Sticky Sidebar) */}
              <div className="w-full lg:w-[35%] bg-[#060c0a] border-l border-white/5 flex flex-col shrink-0">
                
                {/* Right Side Header (Holds Close Button) */}
                <div className="h-24 px-8 flex items-center justify-between border-b border-white/5 shrink-0">
                  <h3 className="text-sm font-black text-[#889995] uppercase tracking-widest">Live Gap Analysis</h3>
                  <button onClick={() => setShowForm(false)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                    <X size={20}/>
                  </button>
                </div>

                <div className="p-8 flex-1 overflow-y-auto custom-scrollbar space-y-8">
                  <div>
                    <h4 className="text-[10px] font-black text-[#fbbf24] uppercase tracking-widest mb-3">Standalone Required (100%)</h4>
                    <div className="bg-white/5 border border-[#fbbf24]/30 p-5 rounded-2xl flex justify-between shadow-[inset_0_0_20px_rgba(251,191,36,0.02)]">
                      <div><label className="text-[9px] font-bold text-[#889995] uppercase block mb-1">SIP Only Path</label><div className="text-xl font-black text-white">₹{Math.round(liveMath.reqSIP).toLocaleString('en-IN')}</div></div>
                      <div className="text-right"><label className="text-[9px] font-bold text-[#889995] uppercase block mb-1">Lump Sum Only</label><div className="text-xl font-black text-white">₹{Math.round(liveMath.reqLS).toLocaleString('en-IN')}</div></div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-[#4ade80] uppercase tracking-widest mb-3">Remaining Deficit Coverage</h4>
                    <div className="bg-[#008254]/10 border border-[#008254]/50 p-5 rounded-2xl flex justify-between gap-4 shadow-[inset_0_0_20px_rgba(0,130,84,0.05)]">
                      <div className="flex-1"><label className="text-[9px] font-bold text-[#889995] uppercase block mb-2">Addl. SIP</label><div className="text-sm font-bold text-[#4ade80] bg-[#008254]/20 p-3 rounded-xl text-center">₹{Math.round(liveMath.deficitSip).toLocaleString('en-IN')}</div></div>
                      <div className="flex-1"><label className="text-[9px] font-bold text-[#889995] uppercase block mb-2">Addl. LS</label><div className="text-sm font-bold text-[#4ade80] bg-[#008254]/20 p-3 rounded-xl text-center">₹{Math.round(liveMath.deficitLs).toLocaleString('en-IN')}</div></div>
                    </div>
                  </div>

                  <div className="bg-[#0a1612] border border-white/10 p-6 rounded-2xl space-y-4 shadow-xl">
                    <div className="flex justify-between border-b border-white/5 pb-3 text-sm font-medium"><span>Future Goal Value:</span> <strong className="text-white">₹{Math.round(liveMath.goalFV).toLocaleString('en-IN')}</strong></div>
                    <div className="flex justify-between border-b border-white/5 pb-3 text-sm font-medium"><span>Target Date:</span> <strong className="text-white">{format(addYears(parseISO(draft.date), Number(draft.years) || 0), "MMM yyyy")}</strong></div>
                    <div className="flex justify-between border-b border-white/5 pb-3 text-sm font-medium"><span>Projected Maturity:</span> <strong className="text-[#4ade80]">₹{Math.round(liveMath.projectedMaturity).toLocaleString('en-IN')}</strong></div>
                    <div className="flex justify-between pt-2 text-base font-black"><span>Funding Gap:</span> <span className={liveMath.gap <= 0 ? "text-[#4ade80]" : "text-[#f87171]"}>₹{Math.round(Math.max(0, liveMath.gap)).toLocaleString('en-IN')}</span></div>
                  </div>
                </div>

                {/* Action Buttons Footer */}
                <div className="p-6 border-t border-white/5 bg-[#050a09] shrink-0 flex flex-col gap-3">
                  <button onClick={handleSaveGoal} className="w-full py-4 rounded-xl font-black bg-[#008254] text-white hover:bg-[#00a369] transition-all shadow-[0_10px_20px_rgba(0,130,84,0.2)] hover:shadow-[0_10px_25px_rgba(0,130,84,0.4)] tracking-wide">
                    SAVE GOAL PLAN
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="w-full py-3.5 rounded-xl font-bold text-[#889995] border border-white/10 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all tracking-wide">
                    CANCEL & DISCARD
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- PREVIEW MODAL (Exportable) --- */}
      {showPreview && activeGoal && (() => {
        const pMath = calculateMath(activeGoal);
        const chartData = [
          { name: "SIP Growth", value: Math.round(pMath.sipMaturity), color: "#008254" },
          { name: "Lump Sum Growth", value: Math.round(pMath.lsMaturity), color: "#4ade80" },
          { name: "Funding Gap", value: Math.round(Math.max(0, pMath.gap)), color: "rgba(255,255,255,0.05)" }
        ];
        const pct = Math.min(100, Math.round((pMath.projectedMaturity / pMath.goalFV) * 100));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-lg">
            <div className="w-full max-w-5xl bg-[#0a1110] border border-[var(--border)] rounded-[28px] flex flex-col max-h-[90vh] shadow-[0_40px_100px_rgba(0,0,0,0.8)] relative overflow-hidden">
              
              <div className="flex justify-between items-center p-6 border-b border-white/5 shrink-0">
                <div>
                  <h2 className="text-xl font-black text-[#008254] tracking-wide uppercase">Profile Preview</h2>
                </div>
                <button onClick={() => setShowPreview(false)} className="text-white/40 hover:text-white hover:rotate-90 transition-all"><X size={28}/></button>
              </div>

              {/* Scrollable container for the exported image */}
              <div className="overflow-y-auto flex-1 custom-scrollbar">
                <div ref={printRef} className="p-8 md:p-10 bg-[#0a1110]">
                  
                  {/* --- EXPORT HEADER (Logo & Title) --- */}
                  <div className="flex justify-between items-center border-b border-white/10 pb-6 mb-8">
                    <img src="/FW_1_logo.png" alt="FideloWealth" className="h-10 object-contain" />
                    <div className="text-right">
                      <h2 className="text-2xl font-black text-[#008254] tracking-wide uppercase">{activeGoal.clientName}</h2>
                      <p className="text-[10px] font-black text-[#889995] uppercase tracking-[2px] mt-1">{activeGoal.goalType}</p>
                    </div>
                  </div>

                  {/* STRICT FLEX LAYOUT FOR HTML2CANVAS */}
                  <div style={{ display: "flex", gap: "40px", alignItems: "flex-start", width: "100%" }}>
                    
                    <div style={{ flex: "1.2", display: "flex", flexDirection: "column", gap: "32px", minWidth: 0 }}>
                      <div>
                        <h3 className="text-[11px] font-black text-[#008254] uppercase tracking-[1px] border-b border-white/10 pb-2 mb-4">Financial Snapshot</h3>
                        
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                          <div style={{ width: "calc(50% - 12px)" }}><label className="text-[9px] font-black text-[#889995] uppercase">PRESENT COST</label><div className="text-xl font-bold text-white mt-1">₹{Number(activeGoal.pv).toLocaleString('en-IN')}</div></div>
                          <div style={{ width: "calc(50% - 12px)" }}><label className="text-[9px] font-black text-[#889995] uppercase">FUTURE GOAL</label><div className="text-xl font-black text-[#fbbf24] mt-1">₹{Math.round(pMath.goalFV).toLocaleString('en-IN')}</div></div>
                          <div style={{ width: "calc(50% - 12px)" }}><label className="text-[9px] font-black text-[#889995] uppercase">TARGET DATE</label><div className="text-xl font-bold text-white mt-1">{format(addYears(parseISO(activeGoal.date), Number(activeGoal.years) || 0), "MMM yyyy")}</div></div>
                          <div style={{ width: "calc(50% - 12px)" }}><label className="text-[9px] font-black text-[#889995] uppercase">TIME HORIZON</label><div className="text-xl font-bold text-white mt-1">{activeGoal.years} Years</div></div>
                          <div style={{ width: "calc(50% - 12px)" }}><label className="text-[9px] font-black text-[#889995] uppercase">INF. RATE</label><div className="text-xl font-bold text-white mt-1">{activeGoal.inf}%</div></div>
                          <div style={{ width: "calc(50% - 12px)" }}><label className="text-[9px] font-black text-[#889995] uppercase">EXP. GROWTH</label><div className="text-xl font-bold text-white mt-1">{activeGoal.growth}%</div></div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-[11px] font-black text-[#008254] uppercase tracking-[1px] border-b border-white/10 pb-2 mb-4">Deployment Strategy</h3>
                        <div className="bg-[var(--glass)] border border-white/10 rounded-2xl p-6">
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
                            <div style={{ flex: 1 }}><label className="text-[9px] font-black text-[#889995] uppercase">ACTUAL INVESTED MATURITY</label><div className="text-2xl font-black text-white mt-1">₹{Math.round(pMath.projectedMaturity).toLocaleString('en-IN')}</div></div>
                            <div style={{ flex: 1 }}><label className="text-[9px] font-black text-[#889995] uppercase">FUNDING GAP</label><div className="text-2xl font-black text-[#f87171] mt-1">₹{Math.round(Math.max(0, pMath.gap)).toLocaleString('en-IN')}</div></div>
                          </div>
                          
                          <div className="mt-4 border-t border-white/10 pt-4">
                            <label className="text-[9px] font-black text-[#889995] uppercase mb-3 block">Sub-Investments Configured ({activeGoal.investments?.length || 0})</label>
                            <div className="space-y-2">
                              {(activeGoal.investments || []).map((inv, i) => (
                                <div key={i} className="flex justify-between items-center bg-black/40 border border-white/5 rounded-lg px-4 py-2.5">
                                  <div className="min-w-0 pr-4 flex items-center">
                                      <span className={`text-[9px] font-black uppercase px-2 py-1 rounded mr-3 shrink-0 ${inv.type === 'SIP' ? 'bg-[#008254]/20 text-[#4ade80]' : 'bg-[#3b82f6]/20 text-[#60a5fa]'}`}>{inv.type}</span>
                                      <span className="text-sm font-semibold text-[#c8d4d0] break-words">{inv.fund || "Unallocated Funds"}</span>
                                  </div>
                                  <span className="text-sm font-black text-white shrink-0">₹{Number(inv.amount).toLocaleString('en-IN')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: "0.8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--glass)", border: "1px solid var(--border)", borderRadius: "24px", padding: "32px", minWidth: 0 }}>
                      <div style={{ width: "280px", height: "280px", position: "relative" }}>
                        
                        {/* STRICT SIZE CHART FOR EXPORT */}
                        <PieChart width={280} height={280}>
                          <Pie data={chartData} cx="50%" cy="50%" innerRadius={95} outerRadius={135} dataKey="value" stroke="none" paddingAngle={2} isAnimationActive={false}>
                            {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                          </Pie>
                        </PieChart>
                        
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                          <span className="text-4xl font-black text-[#4ade80] drop-shadow-[0_0_10px_rgba(74,222,128,0.4)]">{pct}%</span>
                          <span className="text-[10px] font-black text-[#889995] uppercase tracking-widest mt-1">Coverage</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "24px", marginTop: "24px", fontSize: "10px", fontWeight: "bold", color: "#889995", textTransform: "uppercase", letterSpacing: "1px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><div style={{ width: "12px", height: "12px", borderRadius: "4px", background: "#008254" }}></div> SIP</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><div style={{ width: "12px", height: "12px", borderRadius: "4px", background: "#4ade80" }}></div> LS</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><div style={{ width: "12px", height: "12px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.2)", background: "transparent" }}></div> GAP</div>
                      </div>
                    </div>
                  </div>

                  {/* --- EXPORT FOOTER (Socials & Disclaimer) --- */}
                  <div className="mt-12 pt-6 border-t border-white/10">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "24px", marginBottom: "24px", color: "#c8d4d0", fontSize: "11px", fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {/* Branded Social Icons matching reference exactly */}
                        <div className="bg-[#1877F2]/15 text-[#1877F2] p-1.5 rounded-full"><Facebook size={14}/></div>
                        <div className="bg-[#E1306C]/15 text-[#E1306C] p-1.5 rounded-full"><Instagram size={14}/></div>
                        <div className="bg-[#1DA1F2]/15 text-[#1DA1F2] p-1.5 rounded-full"><Twitter size={14}/></div>
                        <span style={{ marginLeft: "4px" }}>fidelowealth</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><div className="bg-[#60a5fa]/15 text-[#60a5fa] p-1.5 rounded-full"><Globe size={14}/></div> www.fidelowealth.com</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><div className="bg-[#ea4335]/15 text-[#ea4335] p-1.5 rounded-full"><Mail size={14}/></div> ask@fidelowealth.com</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><div className="bg-[#4ade80]/15 text-[#4ade80] p-1.5 rounded-full"><Phone size={14}/></div> 9840566166</div>
                    </div>
                    <p className="text-[9px] text-[#889995] text-center leading-relaxed max-w-4xl mx-auto">
                      Disclaimer: Mutual fund investments are subject to market risks. Read all scheme-related documents carefully. 
                      The projected values are strictly for illustrative and planning purposes based on assumed growth rates and do not guarantee future returns. 
                      Past performance is not indicative of future results.
                    </p>
                  </div>
                </div>
              </div>

              {/* Fixed Actions Footer */}
              <div className="p-6 border-t border-white/5 flex justify-end gap-4 bg-black/20 shrink-0">
                <button onClick={handleDownloadImage} disabled={exporting} className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#008254] text-white text-xs font-black hover:bg-[#00a369] transition-all disabled:opacity-50">
                  {exporting ? <Clock size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                  {exporting ? "PROCESSING..." : "DOWNLOAD IMAGE"}
                </button>
                <button onClick={() => setShowPreview(false)} className="px-6 py-3 rounded-xl bg-transparent border border-white/20 text-[#889995] text-xs font-bold hover:text-white hover:border-white transition-all">
                  CLOSE
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}