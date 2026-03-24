import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Plus, X, Pencil, Trash2, FileSpreadsheet, CalendarClock, Users, AlertCircle, Save, Info, Target, Clock, Image as ImageIcon, Globe, Mail, Phone, Facebook, Instagram, Twitter } from "lucide-react";
import { format, parseISO, addYears } from "date-fns";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import html2canvas from "html2canvas";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, doc, updateDoc } from "firebase/firestore";

const GOAL_TYPES = ["Children Marriage", "UG Education", "PG Education", "Home Purchase", "Retirement", "Wealth Creation", "Custom..."];
const STAFF_LIST = ["Uday Pratap Singh", "Ujjwal Kumar", "Prince B Thoppil", "Joel Herbet", "Manfred"];
const FUND_OPTIONS = ["Aditya Birla Sun Life Flexi Cap", "Axis Bluechip Fund", "Bandhan ELSS Tax Saver", "HDFC Mid Cap Opportunities", "ICICI Prudential Bluechip", "Nippon India Small Cap", "Parag Parikh Flexi Cap", "Quant Active Fund", "SBI Small Cap", "Tata Large Cap"]; // Add your full list here

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

  const [fundSearch, setFundSearch] = useState({ index: null, text: "" });

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
    if (!draft.clientId) return alert("Please select a client.");

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

  // --- BULLETPROOF IMAGE EXPORTER ---
  const handleDownloadImage = async () => {
    if (!printRef.current) return;
    setExporting(true);
    
    try {
      const element = printRef.current;
      
      // Temporarily fix width and let height be auto so it perfectly calculates boundaries
      const originalWidth = element.style.width;
      const originalHeight = element.style.height;
      const originalOverflow = element.style.overflow;
      
      element.style.width = '1000px'; 
      element.style.height = 'auto';
      element.style.overflow = 'visible';

      // Give React/DOM a tiny moment to recalculate the auto height layout
      await new Promise(resolve => setTimeout(resolve, 150));

      const canvas = await html2canvas(element, {
        backgroundColor: '#0a1110', 
        scale: 2, 
        useCORS: true,
        logging: false,
        windowWidth: 1000
      });
      
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${activeGoal?.clientName.replace(/\s+/g, '_')}_Goal_Plan.png`;
      link.href = dataUrl;
      link.click();

      // Restore layout
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

  // --- STATS ---
  const today = new Date();
  let pendingReviews = 0;
  filteredGoals.forEach(g => {
    const target = addYears(parseISO(g.date), Number(g.years) || 0);
    const reviewStart = new Date(target); reviewStart.setFullYear(reviewStart.getFullYear() - (Number(g.reviewN) || 2));
    if (today >= reviewStart && today <= target && g.status !== "Completed") pendingReviews++;
  });

  const liveMath = calculateMath(draft);

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

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-center">
          <div className="flex items-center bg-[var(--glass)] border border-[var(--border)] rounded-xl px-4 h-[52px]">
            <CalendarClock size={16} className="text-[#fbbf24] mr-3 shrink-0" />
            <label className="text-[9px] font-black text-[#fbbf24] uppercase mr-2 shrink-0">Review In</label>
            <input type="number" placeholder="N" value={reviewYears} onChange={e => setReviewYears(e.target.value)} className="w-8 bg-transparent border-none text-[#fbbf24] font-bold outline-none" />
            <span className="text-[9px] font-black text-[#fbbf24]">YRS</span>
          </div>

          <div className="flex items-center bg-[var(--glass)] border border-[var(--border)] rounded-xl px-4 h-[52px]">
            <Users size={16} className="text-[#889995] mr-3 shrink-0" />
            <select value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)} className="bg-transparent border-none text-white w-full outline-none text-sm">
              <option value="All">All Staff</option>
              {STAFF_LIST.map(s => <option key={s} value={s} className="bg-[#0a1612]">{s}</option>)}
            </select>
          </div>

          <div className="flex items-center bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 h-[52px] xl:col-span-1.5 flex-1">
            <Search size={16} className="text-[#889995] mr-3 shrink-0" />
            <input type="text" placeholder="Search client name or goal..." value={search} onChange={e => setSearch(e.target.value)} className="bg-transparent border-none text-white w-full outline-none text-sm" />
          </div>

          <div className="flex gap-3 xl:col-span-1.5 justify-end">
            <button onClick={handleExportExcel} className="flex items-center gap-2 bg-[var(--glass)] border border-[var(--border)] hover:border-[#008254] px-6 h-[52px] rounded-xl text-sm font-bold text-white transition-all">
              <FileSpreadsheet size={18} /> EXCEL
            </button>
            <button onClick={openNewForm} className="flex items-center gap-2 bg-[#008254] hover:bg-[#00a369] px-6 h-[52px] rounded-xl text-sm font-bold text-white transition-all shadow-[0_4px_15px_rgba(0,130,84,0.3)]">
              <Plus size={18} /> NEW PLAN
            </button>
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

      {/* --- FULL SCREEN FORM OVERLAY (NON-SCROLLABLE MAIN WINDOW) --- */}
      {showForm && (
        <div className="fixed inset-0 z-[100] bg-[#050a09] flex flex-col animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header */}
          <div className="h-20 px-8 flex justify-between items-center border-b border-white/10 shrink-0 bg-[#0a1612]">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#008254]/20 flex items-center justify-center text-[#4ade80]"><Target size={20}/></div>
              <div>
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Goal Planning Worksheet</h2>
                <p className="text-xs font-bold text-[#889995] mt-1">{draft.id ? "Edit existing financial goal" : "Create a new financial plan"}</p>
              </div>
            </div>
            <button onClick={() => setShowForm(false)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"><X size={20}/></button>
          </div>
          
          {/* 3-Column Layout */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            
            {/* COLUMN 1: Profile & Assumptions */}
            <div className="w-[30%] border-r border-white/10 flex flex-col min-h-0 overflow-y-auto custom-scrollbar bg-[#060c0a]">
              <div className="p-6 space-y-6">
                
                {/* Client Box */}
                <div className="bg-[#0a1612] border border-white/10 rounded-2xl p-5">
                  <h3 className="text-[10px] font-black text-[#008254] uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={12}/> Client Details</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Client Name *</label>
                      <select value={draft.clientId} onChange={e => {
                        const c = clients.find(x => x.id === e.target.value);
                        setDraft({...draft, clientId: c.id, clientName: c.client_name, assigned: c.rm_assigned ? [c.rm_assigned] : [] });
                      }} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs focus:border-[#008254] outline-none" required>
                        <option value="">Select a Client...</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.client_name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Plan Date</label>
                      <input type="date" value={draft.date} onChange={e => setDraft({...draft, date: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-[#fbbf24] text-xs focus:border-[#008254] outline-none" required />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Goal Type</label>
                      <select value={draft.goalType} onChange={e => setDraft({...draft, goalType: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs focus:border-[#008254] outline-none">
                        {GOAL_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                      {draft.goalType === "Custom..." && (
                        <input placeholder="Specify custom goal..." value={draft.customGoal} onChange={e => setDraft({...draft, customGoal: e.target.value})} className="w-full bg-[#050a09] border border-[#fbbf24]/50 p-2.5 rounded-lg text-white text-xs outline-none mt-2" required />
                      )}
                    </div>
                  </div>
                </div>

                {/* Assumptions Box */}
                <div className="bg-[#0a1612] border border-white/10 rounded-2xl p-5">
                  <h3 className="text-[10px] font-black text-[#008254] uppercase tracking-widest mb-4 flex items-center gap-2"><Target size={12}/> Math Assumptions</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2"><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Present Cost (₹)</label><input type="number" value={draft.pv} onChange={e => setDraft({...draft, pv: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none" required /></div>
                    <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Term (Yrs)</label><input type="number" value={draft.years} onChange={e => setDraft({...draft, years: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none" required /></div>
                    <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Review In (Yrs)</label><input type="number" value={draft.reviewN} onChange={e => setDraft({...draft, reviewN: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none" required /></div>
                    <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Inflation (%)</label><input type="number" value={draft.inf} onChange={e => setDraft({...draft, inf: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none" required /></div>
                    <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Growth (%)</label><input type="number" value={draft.growth} onChange={e => setDraft({...draft, growth: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none" required /></div>
                  </div>
                </div>

                {/* Finalization Box */}
                <div className="bg-[#0a1612] border border-white/10 rounded-2xl p-5">
                  <h3 className="text-[10px] font-black text-[#008254] uppercase tracking-widest mb-4 flex items-center gap-2"><Info size={12}/> Settings</h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Risk Appetite</label><select value={draft.risk} onChange={e => setDraft({...draft, risk: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none"><option value="Low">Low Risk</option><option value="Medium">Medium Risk</option><option value="High">High Risk</option></select></div>
                      <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Status</label><select value={draft.status} onChange={e => setDraft({...draft, status: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none"><option value="Active">Active</option><option value="Under-Review">Under Review</option><option value="Paused">Paused</option><option value="Completed">Completed</option></select></div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Assigned Staff</label>
                      <select multiple value={draft.assigned} onChange={e => setDraft({...draft, assigned: Array.from(e.target.selectedOptions, o => o.value)})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none h-[60px] custom-scrollbar">
                        {STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div><label className="block text-[9px] font-bold text-[#889995] uppercase mb-1.5">Admin Notes</label><textarea placeholder="Optional remarks..." value={draft.notes} onChange={e => setDraft({...draft, notes: e.target.value})} className="w-full bg-[#050a09] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none h-[60px] resize-none" /></div>
                  </div>
                </div>

              </div>
            </div>

            {/* COLUMN 2: Sub-Investments */}
            <div className="w-[40%] border-r border-white/10 flex flex-col bg-[#0a1612]">
              <div className="p-6 border-b border-white/10 bg-[#060c0a] shrink-0">
                <h3 className="text-sm font-black text-[#008254] uppercase tracking-widest mb-1 flex items-center gap-2"> Deployment Strategy</h3>
                <p className="text-[10px] font-bold text-[#889995]">Configure the sub-investments driving this goal.</p>
                
                {/* STRATEGY DROPDOWN */}
                <div className="mt-4 bg-[#008254]/10 border border-[#008254]/30 p-3 rounded-xl flex items-center gap-4">
                  <label className="text-[10px] font-black text-[#4ade80] uppercase tracking-wider shrink-0">Investment Mode</label>
                  <select 
                    value={draft.strategyType} 
                    onChange={e => handleStrategyChange(e.target.value)} 
                    className="flex-1 bg-[#050a09] border border-white/10 p-2 rounded-lg text-white text-xs font-bold outline-none cursor-pointer"
                  >
                    <option value="SIP">Monthly SIP Only</option>
                    <option value="LS">Lump Sum Only</option>
                    <option value="SIP_LS">SIP + Lump Sum Hybrid</option>
                  </select>
                </div>
              </div>
              
              {/* Dynamic Investment Rows */}
              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {draft.investments.map((inv, i) => (
                  <div key={i} className="bg-[#050a09] border border-white/10 p-4 rounded-2xl flex flex-col gap-3 relative group hover:border-white/20 transition-colors">
                    
                    <div className="flex items-center gap-3">
                      <select 
                        value={inv.type} 
                        disabled={draft.strategyType !== "SIP_LS"} 
                        onChange={e => { const n = [...draft.investments]; n[i].type = e.target.value; setDraft({...draft, investments: n}); }} 
                        className="bg-[#0a1612] border border-white/10 p-2.5 rounded-lg text-white text-xs font-bold outline-none w-[100px] shrink-0 disabled:opacity-50"
                      >
                        <option value="SIP">SIP</option><option value="LS">Lump Sum</option>
                      </select>
                      
                      <div className="flex-1 relative">
                        <input type="number" placeholder="Amount (₹)" value={inv.amount || ""} onChange={e => { const n = [...draft.investments]; n[i].amount = e.target.value; setDraft({...draft, investments: n}); }} className="w-full bg-[#0a1612] border border-white/10 p-2.5 rounded-lg text-white text-xs outline-none" />
                        {inv.amount && <p className="text-[8px] text-[#4ade80] mt-1 ml-1 italic font-bold absolute">{numberToWords(inv.amount)}</p>}
                      </div>

                      <button type="button" onClick={() => { const n = draft.investments.filter((_, idx) => idx !== i); setDraft({...draft, investments: n}); }} disabled={draft.investments.length === 1} className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-10 shrink-0 border border-red-500/20 transition-all"><X size={14}/></button>
                    </div>
                    
                    <div className="relative mt-1">
                      <input placeholder="Search Fund / Scheme Name..." value={inv.fund || ""} onFocus={() => setFundSearch({ index: i, text: inv.fund || "" })} onChange={e => {
                        const val = e.target.value;
                        const n = [...draft.investments]; n[i].fund = val; setDraft({...draft, investments: n});
                        setFundSearch({ index: i, text: val });
                      }} className="w-full bg-[#0a1612] border border-[#008254]/50 p-2.5 rounded-lg text-white text-xs outline-none font-semibold" />
                      
                      {fundSearch.index === i && (
                        <div className="absolute top-[100%] left-0 right-0 bg-[#0a1612] border border-[#008254] rounded-xl mt-1 z-10 max-h-[160px] overflow-y-auto shadow-2xl custom-scrollbar" onMouseLeave={() => setFundSearch({index: null, text: ""})}>
                          {FUND_OPTIONS.filter(f => f.toLowerCase().includes(fundSearch.text.toLowerCase())).map(f => (
                            <div key={f} onClick={() => {
                              const n = [...draft.investments]; n[i].fund = f; setDraft({...draft, investments: n});
                              setFundSearch({index: null, text: ""});
                            }} className="p-3 text-xs text-white hover:bg-[#008254] cursor-pointer border-b border-white/10">{f}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                <button type="button" onClick={() => setDraft({...draft, investments: [...draft.investments, {type: draft.strategyType === "LS" ? "LS" : "SIP", amount: 0, fund: ""}]})} className="flex items-center gap-1 text-xs font-black text-[#008254] hover:text-[#4ade80] py-2 transition-colors uppercase tracking-wider">
                  <Plus size={14}/> Add Another Fund
                </button>
              </div>
            </div>

            {/* COLUMN 3: Gap Analysis & Live Summary */}
            <div className="w-[30%] flex flex-col bg-[#060c0a] justify-between">
              
              <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                <div>
                  <h3 className="text-[10px] font-black text-[#fbbf24] uppercase tracking-widest mb-3">Standalone Required (100%)</h3>
                  <div className="bg-[var(--glass)] border border-[#fbbf24]/50 p-5 rounded-2xl flex justify-between shadow-[inset_0_0_20px_rgba(251,191,36,0.05)]">
                    <div><label className="text-[8px] font-bold text-[#889995] uppercase block mb-1">SIP Only Path</label><div className="text-xl font-black text-white">₹{Math.round(liveMath.reqSIP).toLocaleString('en-IN')}</div></div>
                    <div className="text-right"><label className="text-[8px] font-bold text-[#889995] uppercase block mb-1">Lump Sum Only Path</label><div className="text-xl font-black text-white">₹{Math.round(liveMath.reqLS).toLocaleString('en-IN')}</div></div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[10px] font-black text-[#4ade80] uppercase tracking-widest mb-3">Remaining Deficit Coverage</h3>
                  <div className="bg-[var(--glass)] border border-[#008254] p-5 rounded-2xl flex justify-between gap-4 shadow-[inset_0_0_20px_rgba(0,130,84,0.1)]">
                    <div className="flex-1"><label className="text-[8px] font-bold text-[#889995] uppercase block mb-1">Addl. SIP</label><div className="text-sm font-bold text-[#4ade80] bg-[#008254]/20 p-2.5 rounded-lg text-center">₹{Math.round(liveMath.deficitSip).toLocaleString('en-IN')}</div></div>
                    <div className="flex-1"><label className="text-[8px] font-bold text-[#889995] uppercase block mb-1">Addl. LS</label><div className="text-sm font-bold text-[#4ade80] bg-[#008254]/20 p-2.5 rounded-lg text-center">₹{Math.round(liveMath.deficitLs).toLocaleString('en-IN')}</div></div>
                  </div>
                </div>

                <div className="bg-[#002d20] border border-[#008254] p-5 rounded-2xl space-y-3">
                  <div className="flex justify-between border-b border-white/10 pb-2 text-xs font-semibold"><span>Future Goal Value:</span> <strong className="text-white">₹{Math.round(liveMath.goalFV).toLocaleString('en-IN')}</strong></div>
                  <div className="flex justify-between border-b border-white/10 pb-2 text-xs font-semibold"><span>Target Date:</span> <strong className="text-white">{format(addYears(parseISO(draft.date), Number(draft.years) || 0), "MMM yyyy")}</strong></div>
                  <div className="flex justify-between border-b border-white/10 pb-2 text-xs font-semibold"><span>Projected Maturity:</span> <strong className="text-[#4ade80]">₹{Math.round(liveMath.projectedMaturity).toLocaleString('en-IN')}</strong></div>
                  <div className="flex justify-between pt-1 text-sm font-black"><span>Funding Gap:</span> <span className={liveMath.gap <= 0 ? "text-[#4ade80]" : "text-[#f87171]"}>₹{Math.round(Math.max(0, liveMath.gap)).toLocaleString('en-IN')}</span></div>
                </div>
              </div>

              {/* Action Buttons Footer */}
              <div className="p-6 border-t border-white/10 bg-[#0a1612] shrink-0 flex flex-col gap-3">
                <button onClick={handleSaveGoal} className="w-full py-4 rounded-xl font-black bg-[#008254] text-white hover:bg-[#00a369] transition-all shadow-[0_10px_20px_rgba(0,130,84,0.3)] hover:shadow-[0_10px_25px_rgba(0,130,84,0.5)]">
                  SAVE GOAL PLAN
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="w-full py-3 rounded-xl font-bold text-[#889995] border border-white/10 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all">
                  CANCEL & DISCARD
                </button>
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
                    <img src="/FW_1_logo_2.png" alt="FideloWealth" className="h-10 object-contain" />
                    <div className="text-right">
                      <h2 className="text-2xl font-black text-[#008254] tracking-wide uppercase">{activeGoal.clientName}</h2>
                      <p className="text-[10px] font-black text-[#889995] uppercase tracking-[2px] mt-1">{activeGoal.goalType}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-10 items-start">
                    <div className="space-y-8">
                      <div>
                        <h3 className="text-[11px] font-black text-[#008254] uppercase tracking-[1px] border-b border-white/10 pb-2 mb-4">Financial Snapshot</h3>
                        <div className="grid grid-cols-2 gap-6 bg-white/5 border border-white/10 rounded-2xl p-6">
                          <div><label className="text-[9px] font-black text-[#889995] uppercase">PRESENT COST</label><div className="text-xl font-bold text-white mt-1">₹{Number(activeGoal.pv).toLocaleString('en-IN')}</div></div>
                          <div><label className="text-[9px] font-black text-[#889995] uppercase">FUTURE GOAL</label><div className="text-xl font-black text-[#fbbf24] mt-1">₹{Math.round(pMath.goalFV).toLocaleString('en-IN')}</div></div>
                          <div><label className="text-[9px] font-black text-[#889995] uppercase">TARGET DATE</label><div className="text-xl font-bold text-white mt-1">{format(addYears(parseISO(activeGoal.date), Number(activeGoal.years) || 0), "MMM yyyy")}</div></div>
                          <div><label className="text-[9px] font-black text-[#889995] uppercase">TIME HORIZON</label><div className="text-xl font-bold text-white mt-1">{activeGoal.years} Years</div></div>
                          <div><label className="text-[9px] font-black text-[#889995] uppercase">INF. RATE</label><div className="text-xl font-bold text-white mt-1">{activeGoal.inf}%</div></div>
                          <div><label className="text-[9px] font-black text-[#889995] uppercase">EXP. GROWTH</label><div className="text-xl font-bold text-white mt-1">{activeGoal.growth}%</div></div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-[11px] font-black text-[#008254] uppercase tracking-[1px] border-b border-white/10 pb-2 mb-4">Deployment Strategy</h3>
                        <div className="bg-[var(--glass)] border border-white/10 rounded-2xl p-6">
                          <div className="flex justify-between mb-6">
                            <div className="flex-1"><label className="text-[9px] font-black text-[#889995] uppercase">ACTUAL INVESTED MATURITY</label><div className="text-2xl font-black text-white mt-1">₹{Math.round(pMath.projectedMaturity).toLocaleString('en-IN')}</div></div>
                            <div className="flex-1"><label className="text-[9px] font-black text-[#889995] uppercase">FUNDING GAP</label><div className="text-2xl font-black text-[#f87171] mt-1">₹{Math.round(Math.max(0, pMath.gap)).toLocaleString('en-IN')}</div></div>
                          </div>
                          
                          <div className="mt-4 border-t border-white/10 pt-4">
                            <label className="text-[9px] font-black text-[#889995] uppercase mb-3 block">Sub-Investments Configured ({activeGoal.investments?.length || 0})</label>
                            <div className="space-y-2">
                              {(activeGoal.investments || []).map((inv, i) => (
                                <div key={i} className="flex justify-between items-center bg-black/40 border border-white/5 rounded-lg px-4 py-2.5">
                                  <div className="min-w-0 pr-4 flex items-center">
                                      <span className={`text-[9px] font-black uppercase px-2 py-1 rounded mr-3 shrink-0 ${inv.type === 'SIP' ? 'bg-[#008254]/20 text-[#4ade80]' : 'bg-blue-500/20 text-blue-400'}`}>{inv.type}</span>
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

                    <div className="flex flex-col items-center justify-center bg-[var(--glass)] border border-[var(--border)] rounded-3xl p-8 h-fit">
                      <div style={{ width: "280px", height: "280px" }} className="relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={chartData} cx="50%" cy="50%" innerRadius={95} outerRadius={135} dataKey="value" stroke="none" paddingAngle={2} isAnimationActive={false}>
                              {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "white" }} itemStyle={{ color: "white", fontWeight: "bold" }} formatter={(val) => `₹${val.toLocaleString('en-IN')}`} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-4xl font-black text-[#4ade80] drop-shadow-[0_0_10px_rgba(74,222,128,0.4)]">{pct}%</span>
                          <span className="text-[10px] font-black text-[#889995] uppercase tracking-widest mt-1">Coverage</span>
                        </div>
                      </div>

                      <div className="flex gap-6 mt-6 text-[10px] font-bold text-[#889995] uppercase tracking-wider">
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-[#008254]"></div> SIP</div>
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-[#4ade80]"></div> LS</div>
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded border border-white/20 bg-transparent"></div> GAP</div>
                      </div>
                    </div>
                  </div>

                  {/* --- EXPORT FOOTER (Socials & Disclaimer) --- */}
                  <div className="mt-12 pt-6 border-t border-white/10">
                    <div className="flex flex-wrap items-center justify-center gap-6 mb-6 text-[#c8d4d0] text-xs font-semibold">
                      <div className="flex items-center gap-2">
                        <div className="bg-white/10 p-1.5 rounded-full"><Facebook size={14}/></div>
                        <div className="bg-white/10 p-1.5 rounded-full"><Instagram size={14}/></div>
                        <div className="bg-white/10 p-1.5 rounded-full"><Twitter size={14}/></div>
                        <span className="ml-1">fidelowealth</span>
                      </div>
                      <div className="flex items-center gap-2"><div className="bg-white/10 p-1.5 rounded-full"><Globe size={14}/></div> www.fidelowealth.com</div>
                      <div className="flex items-center gap-2"><div className="bg-white/10 p-1.5 rounded-full"><Mail size={14}/></div> ask@fidelowealth.com</div>
                      <div className="flex items-center gap-2"><div className="bg-[#4ade80]/20 text-[#4ade80] p-1.5 rounded-full"><Phone size={14}/></div> 9840566166</div>
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