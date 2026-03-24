import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, parseISO, subMonths } from "date-fns";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart
} from "recharts";
import { RefreshCw, Save, Pencil, LineChart as ChartIcon, Users, Wallet, Database, Activity, CalendarClock } from "lucide-react";
import * as XLSX from "xlsx";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, getDocs, orderBy, where, doc, setDoc, onSnapshot } from "firebase/firestore";

const SIP_CREATE_ACTIONS = ["SIP Registration", "SIP Restart", "SIP Top-up"];
const LS_CREATE_ACTIONS = ["Lumpsum Purchase", "NFO Purchase"];
const SIP_CEASE_ACTIONS = ["SIP Cancellation", "SIP Stop", "SIP Pause"];
const REDEMPTION_ACTIONS = ["Redemption", "Scheme Redemption"];

// --- FORMATTERS ---
const formatCr = (val) => {
  if (val == null || isNaN(val)) return "-";
  const num = Number(val);
  const sign = num < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(num) / 10000000).toFixed(2)} Cr`;
};

const formatL = (val) => {
  if (val == null || isNaN(val)) return "-";
  const num = Number(val);
  const sign = num < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(num) / 100000).toFixed(2)} L`;
};

// Helper to determine Financial Year (April to March)
const getFinancialYear = (monthId) => {
  if (!monthId) return "Unknown";
  const [yearStr, monthStr] = monthId.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  if (month >= 4) {
    return `FY ${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    return `FY ${year - 1}-${year.toString().slice(-2)}`;
  }
};

const tooltipStyle = {
  contentStyle: { background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#c8d4d0", fontSize: 12 },
  labelStyle: { color: "#889995", marginBottom: 4 },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};

const cardStyle = { background: "#0a1612", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24, marginBottom: 24 };
const inputStyle = { padding: "8px 12px", borderRadius: 8, background: "#050a09", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 13, width: "100%", outline: "none" };
const labelStyle = { display: "block", fontSize: 10, fontWeight: 700, color: "#889995", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 };

// Helper: Parse the structured text string to extract transactions and amounts
function parseTransactionItems(rawString) {
  if (!rawString) return [];
  const lines = rawString.split("\n");
  return lines.map(line => {
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
}

export default function InvestmentReport() {
  const [activeTab, setActiveTab] = useState("aum");
  const [completedTasks, setCompletedTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "yyyy-MM"));
  const [selectedFY, setSelectedFY] = useState("All");

  const formRef = useRef(null);

  const [isEditingStat, setIsEditingStat] = useState(false);
  const [statForm, setStatForm] = useState({
    monthId: format(new Date(), "yyyy-MM"),
    aum: "", purchase: "", redemption: ""
  });

  // --- SINGLE UNIFIED FETCH: Grabs All Clients & Completed Tasks ---
  useEffect(() => {
    // 1. Fetch Clients for SIP Book calculation
    const unsubClients = onSnapshot(collection(db, "clients"), (snap) => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 2. Fetch ALL Completed Tasks for RM Sourcing & Historical SIP Flow calculation
    const qTasks = query(collection(db, "tasks"), where("status", "==", "Completed"));
    const unsubTasks = onSnapshot(qTasks, (snap) => {
      setCompletedTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Error with live task sync:", error);
    });

    return () => { unsubClients(); unsubTasks(); }; 
  }, []);

  const fetchMonthlyStats = useCallback(async () => {
    try {
      const qStats = query(collection(db, "monthly_stats"));
      const snapshotStats = await getDocs(qStats);
      let rawStats = snapshotStats.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Sort chronologically before math
      rawStats.sort((a, b) => a.monthId.localeCompare(b.monthId));

      let processedStats = [];
      let prevAUM = 0, cumCashflow = 0;

      rawStats.forEach((stat) => {
        const currentAUM = Number(stat.aum) || 0;
        const currentPurchase = Number(stat.purchase) || 0;
        const currentRedemption = Number(stat.redemption) || 0;

        const netCashflow = currentPurchase - currentRedemption;
        cumCashflow += netCashflow;

        const aumChange = prevAUM !== 0 ? currentAUM - prevAUM : 0;
        const aumChangePct = prevAUM !== 0 ? Number(((aumChange / prevAUM) * 100).toFixed(2)) : 0;

        processedStats.push({
          ...stat,
          totalAUM: currentAUM, 
          aumChange, 
          aumChangePct,
          purchase: currentPurchase, 
          redemption: currentRedemption,
          netCashflow, 
          cumCashflow,
          displayMonth: format(parseISO(stat.monthId + "-01"), "MMM yy"),
          financialYear: getFinancialYear(stat.monthId)
        });

        prevAUM = currentAUM; 
      });

      setMonthlyStats(processedStats);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMonthlyStats(); }, [fetchMonthlyStats]);

  const handleSaveStat = async (e) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, "monthly_stats", statForm.monthId), statForm, { merge: true });
      setIsEditingStat(false);
      setStatForm({ monthId: format(new Date(), "yyyy-MM"), aum: "", purchase: "", redemption: "" });
      fetchMonthlyStats();
    } catch (e) { console.error(e); }
  };

  const handleEditRow = (stat) => {
    setStatForm({
      monthId: stat.monthId,
      aum: stat.aum ?? "",
      purchase: stat.purchase ?? "",
      redemption: stat.redemption ?? ""
    });
    setIsEditingStat(true);
    if (formRef.current) formRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleImportExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setRefreshing(true);
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const mainSheet = workbook.Sheets[workbook.SheetNames.find(n => n.toLowerCase().includes("aum") && n.toLowerCase().includes("sip"))];
        if (!mainSheet) return alert("Tab 'AUM & SIP' not found");
        
        const lines = XLSX.utils.sheet_to_json(mainSheet, { header: 1 });
        const monthsMap = {};
        
        const cleanNum = (v) => (!v || v === "-" ? 0 : parseFloat(String(v).replace(/,/g, '').replace(/₹/g, '').trim()) || 0);

        lines.slice(3).forEach(row => {
          let d = row[0] || row[4] || row[8] || row[14] || row[20];
          if (!d) return;

          let year, month;

          if (d instanceof Date && !isNaN(d)) {
             year = d.getFullYear();
             month = String(d.getMonth() + 1).padStart(2, '0');
          } else if (typeof d === 'string') {
             const dateStr = d.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
             const parts = dateStr.split(/[-/]/);
             if (parts.length >= 3) {
                 if (parts[0].length === 4) { year = parts[0]; month = parts[1]; } 
                 else if (parts[2].length === 4) { year = parts[2]; month = parseInt(parts[1]) <= 12 ? parts[1] : parts[0]; }
                 else { year = '20' + parts[2].slice(-2); month = parseInt(parts[1]) <= 12 ? parts[1] : parts[0]; }
             }
          }

          if (month && year) {
             const mKey = `${year}-${String(month).padStart(2, '0')}`;
             monthsMap[mKey] = {
                monthId: mKey,
                aum: cleanNum(row[1]) + cleanNum(row[5]),
                purchase: cleanNum(row[21]),
                redemption: cleanNum(row[22])
             };
          }
        });

        const uploadPromises = Object.entries(monthsMap).map(([id, payload]) => setDoc(doc(db, "monthly_stats", id), payload, { merge: true }));
        await Promise.all(uploadPromises);
        fetchMonthlyStats();
      } catch (err) { console.error(err); } finally { setRefreshing(false); }
    };
    reader.readAsArrayBuffer(file);
  };

  const chartData = useMemo(() => monthlyStats.filter(s => selectedFY === "All" || s.financialYear === selectedFY), [monthlyStats, selectedFY]);
  const availableFYs = ["All", ...new Set(monthlyStats.map(s => s.financialYear))].sort().reverse();

  // --- AUTOMATED SIP GROWTH ENGINE ---
  const sipGrowthData = useMemo(() => {
    // 1. Sum up the current true state of the SIP book from Client Master
    let currentSipBook = 0;
    clients.forEach(c => {
      const targetKey = Object.keys(c).find(k => k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('investments') || k.toLowerCase().includes('sips')) || "investments";
      const invs = c[targetKey] || [];
      invs.forEach(inv => {
        if (inv.type === "SIP" || inv.frequency_type === "Monthly") {
          currentSipBook += Number(String(inv.installment_amount).replace(/,/g, '')) || 0;
        }
      });
    });

    // 2. Aggregate all historical Net Flows (Added - Cancelled) by month from Completed Tasks
    const sipFlowsByMonth = {};
    completedTasks.forEach(task => {
      const d = task.closure_date || task.entry_date;
      if (!d) return;
      const monthId = d.substring(0, 7);
      if (!sipFlowsByMonth[monthId]) sipFlowsByMonth[monthId] = 0;

      let sAmt = 0; let cAmt = 0;
      let taskAmt = Number(task.amount) || 0;
      if (taskAmt === 0 && task.product_name) {
        const parsed = parseTransactionItems(task.product_name);
        taskAmt = parsed.reduce((sum, item) => sum + (Number(item.amount)||0), 0);
      }

      if (SIP_CREATE_ACTIONS.includes(task.action)) sAmt += taskAmt;
      else if (SIP_CEASE_ACTIONS.includes(task.action)) cAmt += taskAmt;
      else if (task.action === "Lumpsum & SIP") {
         const parsed = parseTransactionItems(task.product_name);
         parsed.forEach(item => {
           if (item.type === "SIP" || !item.type) sAmt += (Number(item.amount)||0);
         });
      }
      
      sipFlowsByMonth[monthId] += (sAmt - cAmt);
    });

    // 3. Project backwards up to 12 months
    const months = [];
    for(let i = 0; i < 12; i++) {
      months.push(format(subMonths(new Date(), i), "yyyy-MM"));
    }
    months.sort();

    let runningBook = currentSipBook;
    const reverseMonths = [...months].reverse();
    const resultData = [];

    // Traverse backwards: Start of month = End of month - Net flows of that month
    reverseMonths.forEach(mId => {
       const flow = sipFlowsByMonth[mId] || 0;
       const endBook = runningBook;
       const startBook = runningBook - flow;
       
       resultData.push({
         monthId: mId,
         displayMonth: format(parseISO(`${mId}-01`), "MMM yy"),
         sipBook: endBook,
         netFlow: flow,
         financialYear: getFinancialYear(mId)
       });
       runningBook = startBook;
    });

    return resultData.reverse(); // Restore to chronological order
  }, [clients, completedTasks]);


  // --- RM AGGREGATION LOGIC ---
  const { reportData, grandTotals } = useMemo(() => {
    const stats = {};
    let totals = { sip: 0, purchase: 0, redemption: 0, sipCease: 0, netSip: 0, netPurchase: 0 };
    
    // Filter completed tasks for ONLY the selected RM month
    const rmTasks = completedTasks.filter(t => {
      const d = t.closure_date || t.entry_date || "";
      return d.startsWith(selectedMonth);
    });

    rmTasks.forEach(task => {
      const rm = task.assigned_to || "Unassigned";
      if (!stats[rm]) stats[rm] = { name: rm, sip: 0, purchase: 0, redemption: 0, sipCease: 0, netSip: 0, netPurchase: 0 };
      
      let sAmt = 0, pAmt = 0, rAmt = 0, cAmt = 0;
      
      // Robust Fallback: Extract from product text if standard amount field is blank
      let taskAmt = Number(task.amount) || 0;
      if (taskAmt === 0 && task.product_name) {
        const parsedItems = parseTransactionItems(task.product_name);
        taskAmt = parsedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      }

      if (SIP_CREATE_ACTIONS.includes(task.action)) { sAmt += taskAmt; } 
      else if (LS_CREATE_ACTIONS.includes(task.action)) { pAmt += taskAmt; }
      else if (SIP_CEASE_ACTIONS.includes(task.action)) { cAmt += taskAmt; }
      else if (REDEMPTION_ACTIONS.includes(task.action)) { rAmt += taskAmt; }
      else if (task.action === "Lumpsum & SIP") {
        const parsedHybrid = parseTransactionItems(task.product_name);
        parsedHybrid.forEach(item => {
           const amt = Number(item.amount) || 0;
           if (item.type === "SIP") sAmt += amt;
           else if (item.type === "LS") pAmt += amt;
        });
      }

      stats[rm].sip += sAmt;
      stats[rm].purchase += pAmt;
      stats[rm].sipCease += cAmt;
      stats[rm].redemption += rAmt;
      stats[rm].netSip += (sAmt - cAmt);
      stats[rm].netPurchase += (pAmt - rAmt);

      totals.sip += sAmt;
      totals.purchase += pAmt;
      totals.sipCease += cAmt;
      totals.redemption += rAmt;
      totals.netSip += (sAmt - cAmt);
      totals.netPurchase += (pAmt - rAmt);
    });

    return { 
      reportData: Object.values(stats).sort((a, b) => (b.sip + b.purchase) - (a.sip + a.purchase)), 
      grandTotals: totals 
    };
  }, [completedTasks, selectedMonth]);

  if (loading) return <div className="h-screen flex items-center justify-center text-[#889995]">Loading analytics...</div>;

  return (
    <div style={{ background: "#050a09", minHeight: "100vh", padding: "28px 24px", color: "#c8d4d0" }}>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
        
        /* --- YELLOW CALENDAR ICON FIX --- */
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="month"]::-webkit-calendar-picker-indicator {
          filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%);
          opacity: 1;
          cursor: pointer;
        }
        input[type="date"], input[type="month"] {
          color-scheme: dark;
          color: #fbbf24 !important; 
          font-weight: 700;
        }
      `}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>Investment Analytics</h1>
            <p style={{ fontSize: 13, color: "#889995" }}>Pooled Performance Tracking</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(96, 165, 250, 0.1)", color: "#60a5fa", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
              <Database size={16} /> Import Historical
              <input type="file" accept=".xlsx" onChange={handleImportExcel} style={{ display: "none" }} />
            </label>
            <button onClick={fetchMonthlyStats} style={{ padding: "10px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#889995" }}>
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 24, borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: 32 }}>
          {["aum", "sip", "cashflow", "rm"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ paddingBottom: 12, fontSize: 14, fontWeight: 700, borderBottom: activeTab === tab ? "2px solid #4ade80" : "none", color: activeTab === tab ? "#4ade80" : "#889995", background: "transparent", cursor: "pointer", textTransform: "capitalize" }}>
              {tab === "rm" ? "RM Sourcing" : tab === "aum" ? "AUM Growth" : tab === "sip" ? "SIP Book Growth" : "Cashflow"}
            </button>
          ))}
        </div>

        {activeTab !== "rm" ? (
          <>
            {/* Entry Form (Hidden for SIP Book since it's fully automated) */}
            {activeTab !== "sip" && (
              <div style={cardStyle} ref={formRef}>
                <form onSubmit={handleSaveStat} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
                  <div><label style={labelStyle}>Month</label><input type="month" value={statForm.monthId} onChange={e => setStatForm({...statForm, monthId: e.target.value})} style={inputStyle} required disabled={isEditingStat} /></div>
                  <div><label style={labelStyle}>Total AUM (₹)</label><input type="number" value={statForm.aum} onChange={e => setStatForm({...statForm, aum: e.target.value})} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Purchase (₹)</label><input type="number" value={statForm.purchase} onChange={e => setStatForm({...statForm, purchase: e.target.value})} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Redemption (₹)</label><input type="number" value={statForm.redemption} onChange={e => setStatForm({...statForm, redemption: e.target.value})} style={inputStyle} /></div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <button type="submit" style={{ flex: 1, height: 38, borderRadius: 8, background: "#008254", color: "white", border: "none", fontWeight: 700, cursor: "pointer" }}>Save</button>
                    {isEditingStat && <button type="button" onClick={() => {setIsEditingStat(false); setStatForm({ monthId: format(new Date(), "yyyy-MM"), aum: "", purchase: "", redemption: "" });}} style={{ height: 38, padding: "0 16px", borderRadius: 8, background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid #f87171", cursor: "pointer" }}>Cancel</button>}
                  </div>
                </form>
              </div>
            )}

            {/* Main Analytical Charts */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontWeight: 700 }}>
                  {activeTab === 'aum' ? 'AUM Growth' : activeTab === 'sip' ? 'Automated SIP Book Trajectory' : 'Cashflow Trends'}
                </h3>
                <select value={selectedFY} onChange={e => setSelectedFY(e.target.value)} style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", padding: "4px 8px", borderRadius: 6, fontWeight: 700, outline: "none" }}>
                  {availableFYs.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={350}>
                {activeTab === "aum" ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="displayMonth" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} />
                    <YAxis tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} tickFormatter={(v) => formatCr(v).replace('₹', '')} />
                    <Tooltip {...tooltipStyle} formatter={(v) => formatCr(v)} />
                    <Line type="monotone" dataKey="totalAUM" stroke="#4ade80" strokeWidth={3} name="Total AUM" dot={{ r: 6 }} />
                  </LineChart>
                ) : activeTab === "sip" ? (
                  <ComposedChart data={sipGrowthData.filter(s => selectedFY === "All" || s.financialYear === selectedFY)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="displayMonth" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} />
                    <YAxis yAxisId="left" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} tickFormatter={(v) => formatL(v).replace('₹', '')} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "#fbbf24", fontSize: 12 }} axisLine={false} tickFormatter={(v) => formatL(v).replace('₹', '')} />
                    <Tooltip {...tooltipStyle} formatter={(v) => formatL(v)} />
                    <Legend />
                    <Bar yAxisId="right" dataKey="netFlow" fill="#60a5fa" name="Net SIP Sourced" />
                    <Line yAxisId="left" type="monotone" dataKey="sipBook" stroke="#4ade80" strokeWidth={3} name="Total SIP Book Size" dot={{ r: 4 }} />
                  </ComposedChart>
                ) : (
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="displayMonth" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} />
                    <YAxis yAxisId="left" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} tickFormatter={(v) => formatL(v).replace('₹', '')} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "#fbbf24", fontSize: 12 }} axisLine={false} tickFormatter={(v) => formatL(v).replace('₹', '')} />
                    <Tooltip {...tooltipStyle} formatter={(v) => formatL(v)} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="purchase" fill="#60a5fa" name="Purchase" />
                    <Bar yAxisId="left" dataKey="redemption" fill="#f87171" name="Redemption" />
                    <Line yAxisId="right" type="stepAfter" dataKey="cumCashflow" stroke="#fbbf24" strokeWidth={3} name="Cumulative Net Flow" dot={false} />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Data Tables */}
            <div style={{ ...cardStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#556660", fontSize: 10, textTransform: "uppercase" }}>
                    {activeTab === 'aum' ? (
                      <>
                        <th style={{ padding: 12, textAlign: "left" }}>Month</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Total AUM</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Change</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Growth (%)</th>
                        <th style={{ padding: 12, textAlign: "center" }}>Act</th>
                      </>
                    ) : activeTab === 'sip' ? (
                      <>
                        <th style={{ padding: 12, textAlign: "left" }}>Month</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Total SIP Book Size</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Net Sourced Flow</th>
                      </>
                    ) : (
                      <>
                        <th style={{ padding: 12, textAlign: "left" }}>Month</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Purchase</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Redemption</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Net Flow</th>
                        <th style={{ padding: 12, textAlign: "right" }}>Cumulative</th>
                        <th style={{ padding: 12, textAlign: "center" }}>Act</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {activeTab === 'sip' ? (
                    [...sipGrowthData].reverse().map(s => {
                      if (selectedFY !== "All" && s.financialYear !== selectedFY) return null;
                      const flowColor = s.netFlow >= 0 ? "#4ade80" : "#f87171";
                      return (
                        <tr key={s.monthId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                          <td style={{ padding: 12, fontWeight: 700 }}>
                            {s.displayMonth}
                            <span style={{ display: "block", fontSize: 9, color: "#556660", marginTop: 2 }}>{s.financialYear}</span>
                          </td>
                          <td style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "white" }}>{formatL(s.sipBook)}</td>
                          <td style={{ padding: 12, textAlign: "right", color: flowColor, fontWeight: 700 }}>{s.netFlow > 0 ? "+" : ""}{formatL(s.netFlow)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    [...monthlyStats].reverse().map(s => {
                      if (selectedFY !== "All" && s.financialYear !== selectedFY) return null;

                      const aumColor = s.aumChange >= 0 ? "#4ade80" : "#f87171";
                      const flowColor = s.netCashflow >= 0 ? "#4ade80" : "#f87171";

                      return (
                        <tr key={s.monthId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                          <td style={{ padding: 12, fontWeight: 700 }}>
                            {s.displayMonth}
                            <span style={{ display: "block", fontSize: 9, color: "#556660", marginTop: 2 }}>{s.financialYear}</span>
                          </td>
                          
                          {activeTab === 'aum' ? (
                            <>
                              <td style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "white" }}>{formatCr(s.totalAUM)}</td>
                              <td style={{ padding: 12, textAlign: "right", color: aumColor }}>{s.aumChange > 0 ? "+" : ""}{formatCr(s.aumChange)}</td>
                              <td style={{ padding: 12, textAlign: "right", color: aumColor }}>{s.aumChangePct > 0 ? "+" : ""}{s.aumChangePct}%</td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: 12, textAlign: "right", color: "#60a5fa" }}>{formatL(s.purchase)}</td>
                              <td style={{ padding: 12, textAlign: "right", color: "#f87171" }}>{formatL(s.redemption)}</td>
                              <td style={{ padding: 12, textAlign: "right", color: flowColor, fontWeight: 700 }}>{s.netCashflow > 0 ? "+" : ""}{formatL(s.netCashflow)}</td>
                              <td style={{ padding: 12, textAlign: "right", color: "#fbbf24", fontWeight: 600 }}>{formatL(s.cumCashflow)}</td>
                            </>
                          )}
                          
                          <td style={{ padding: 12, textAlign: "center" }}>
                            <button onClick={() => handleEditRow(s)} style={{ background: "transparent", border: "none", color: "#889995", cursor: "pointer" }} title="Edit Record"><Pencil size={14}/></button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="animate-in fade-in">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
               <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,130,84,0.1)", padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(0,130,84,0.3)"}}>
                  <Activity size={20} color="#4ade80" />
                  <div>
                    <p style={{fontSize: 10, color: "#889995", fontWeight: 800, textTransform: "uppercase"}}>Status</p>
                    <p style={{fontSize: 13, color: "#4ade80", fontWeight: 700}}>Live Syncing Completed Tasks</p>
                  </div>
               </div>

               {/* Beautiful Yellow Month Picker Box */}
               <div style={{ display: "flex", alignItems: "center", background: "#0a1612", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 12, padding: "0 16px", height: 52 }}>
                 <CalendarClock size={16} className="text-[#fbbf24]" style={{ marginRight: 12 }} />
                 <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ background: "transparent", border: "none", color: "#fbbf24", outline: "none", fontWeight: 700, fontSize: 14 }} />
               </div>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
              {[
                { label: "SIP Sourced", amount: grandTotals.sip, color: "#4ade80" },
                { label: "SIP Ceased", amount: grandTotals.sipCease, color: "#f87171" },
                { label: "Net SIP Sourced", amount: grandTotals.netSip, color: grandTotals.netSip >= 0 ? "#4ade80" : "#f87171" },
                { label: "Lumpsum Sourced", amount: grandTotals.purchase, color: "#60a5fa" },
                { label: "Redemptions", amount: grandTotals.redemption, color: "#f87171" },
                { label: "Net Lumpsum", amount: grandTotals.netPurchase, color: grandTotals.netPurchase >= 0 ? "#60a5fa" : "#f87171" },
              ].map(s => (
                <div key={s.label} style={cardStyle}>
                  <p style={{ fontSize: 26, fontWeight: 800, color: s.color, margin: 0 }}>{formatL(s.amount)}</p>
                  <p style={{ fontSize: 11, color: "#889995", fontWeight: 600, marginTop: 4, textTransform: "uppercase" }}>{s.label}</p>
                </div>
              ))}
            </div>

            <div style={cardStyle}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#556660", fontSize: 10, textTransform: "uppercase" }}>
                    <th style={{ padding: 12, textAlign: "left" }}>RM Name</th>
                    <th style={{ padding: 12, textAlign: "right" }}>SIP</th>
                    <th style={{ padding: 12, textAlign: "right" }}>SIP Cease</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Net SIP</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Purchase</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Redemption</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Net Purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.map(row => (
                    <tr key={row.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: 12, fontWeight: 700, color: "#c8d4d0" }}>{row.name}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{formatL(row.sip)}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#f87171", fontWeight: 600 }}>{formatL(row.sipCease)}</td>
                      <td style={{ padding: 12, textAlign: "right", color: row.netSip >= 0 ? "#4ade80" : "#f87171", fontWeight: 700 }}>{formatL(row.netSip)}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#60a5fa", fontWeight: 600 }}>{formatL(row.purchase)}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#f87171", fontWeight: 600 }}>{formatL(row.redemption)}</td>
                      <td style={{ padding: 12, textAlign: "right", color: row.netPurchase >= 0 ? "#60a5fa" : "#f87171", fontWeight: 700 }}>{formatL(row.netPurchase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}