import { useState, useEffect, useCallback, useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart
} from "recharts";
import { RefreshCw, Download, Save, Pencil, LineChart as ChartIcon, Users, Wallet, TrendingUp } from "lucide-react";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, getDocs, orderBy, where, doc, setDoc } from "firebase/firestore";

const SIP_CREATE_ACTIONS = ["SIP Registration", "SIP Restart", "SIP Top-up"];
const LS_CREATE_ACTIONS = ["Lumpsum Purchase", "NFO Purchase"];
const SIP_CEASE_ACTIONS = ["SIP Cancellation", "SIP Stop", "SIP Pause"];
const REDEMPTION_ACTIONS = ["Redemption", "Scheme Redemption"];
const SWITCH_ACTIONS = ["Switch", "SIP Switch", "Scheme Switch"];
const COMBO_ACTION = "Lumpsum & SIP";

const tooltipStyle = {
  contentStyle: { background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#c8d4d0", fontSize: 12 },
  labelStyle: { color: "#889995", marginBottom: 4 },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};

const cardStyle = { background: "#0a1612", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24, marginBottom: 24 };
const inputStyle = { padding: "8px 12px", borderRadius: 8, background: "#050a09", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d4d0", fontSize: 13, width: "100%", outline: "none" };
const labelStyle = { display: "block", fontSize: 10, fontWeight: 700, color: "#889995", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 };

export default function InvestmentReport() {
  const [activeTab, setActiveTab] = useState("aum");
  const [tasks, setTasks] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "yyyy-MM"));
  const [selectedYear, setSelectedYear] = useState("All");

  const [isEditingStat, setIsEditingStat] = useState(false);
  const [statForm, setStatForm] = useState({
    monthId: format(new Date(), "yyyy-MM"),
    aum_54522: "", aum_340387: "", 
    sip_54522: "", sip_340387: "",
    purchase: "", redemption: "",
    sensex: ""
  });

  const fetchAllData = useCallback(async () => {
    setRefreshing(true);
    try {
      const qTasks = query(collection(db, "tasks"), where("status", "==", "Completed"), orderBy("entry_date", "desc"));
      const snapshotTasks = await getDocs(qTasks);
      setTasks(snapshotTasks.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      const qStats = query(collection(db, "monthly_stats"), orderBy("monthId", "asc"));
      const snapshotStats = await getDocs(qStats);
      let rawStats = snapshotStats.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (rawStats.length === 0) {
        const seedDataFeb = {
          monthId: "2026-02",
          aum_54522: 577178463, aum_340387: 147638548,
          sip_54522: 3792500, sip_340387: 2528000,
          purchase: 1200000, redemption: 350000, sensex: 72500
        };
        const seedDataMar = {
          monthId: "2026-03",
          aum_54522: 585000000, aum_340387: 150000000,
          sip_54522: 3900000, sip_340387: 2600000,
          purchase: 1500000, redemption: 200000, sensex: 73800
        };
        await setDoc(doc(db, "monthly_stats", "2026-02"), seedDataFeb);
        await setDoc(doc(db, "monthly_stats", "2026-03"), seedDataMar);
        rawStats = [seedDataFeb, seedDataMar];
      }
      
      let processedStats = [];
      let prevTotalAUM = 0;
      let prevTotalSIP = 0;
      let cumCashflow = 0;

      rawStats.forEach((stat, index) => {
        const totalAUM = (Number(stat.aum_54522) || 0) + (Number(stat.aum_340387) || 0);
        const totalSIP = (Number(stat.sip_54522) || 0) + (Number(stat.sip_340387) || 0);
        const netCashflow = (Number(stat.purchase) || 0) - (Number(stat.redemption) || 0);
        cumCashflow += netCashflow;

        const aumChange = index === 0 ? 0 : totalAUM - prevTotalAUM;
        const aumChangePct = index === 0 || prevTotalAUM === 0 ? 0 : ((aumChange / prevTotalAUM) * 100).toFixed(2);
        const sipChange = index === 0 ? 0 : totalSIP - prevTotalSIP;

        processedStats.push({
          ...stat,
          totalAUM, aumChange, aumChangePct: Number(aumChangePct),
          totalSIP, sipChange,
          netCashflow, cumCashflow,
          displayMonth: format(parseISO(stat.monthId + "-01"), "MMM yy")
        });

        prevTotalAUM = totalAUM;
        prevTotalSIP = totalSIP;
      });

      setMonthlyStats(processedStats);
    } catch (error) { console.error(error); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  const handleSaveStat = async (e) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, "monthly_stats", statForm.monthId), statForm);
      setIsEditingStat(false);
      setStatForm({ monthId: format(new Date(), "yyyy-MM"), aum_54522: "", aum_340387: "", sip_54522: "", sip_340387: "", purchase: "", redemption: "", sensex: "" });
      fetchAllData();
    } catch (e) { console.error(e); }
  };

  const chartData = useMemo(() => {
    return monthlyStats.filter(s => selectedYear === "All" || s.monthId.startsWith(selectedYear));
  }, [monthlyStats, selectedYear]);

  const availableYears = ["All", ...new Set(monthlyStats.map(s => s.monthId.substring(0,4)))].sort().reverse();

  if (loading) return <div className="h-screen flex items-center justify-center text-[#889995]">Loading analytics...</div>;

  return (
    <div style={{ background: "#050a09", minHeight: "100vh", padding: "28px 24px", color: "#c8d4d0" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>Investment Analytics</h1>
            <p style={{ fontSize: 13, color: "#889995" }}>AUM & SIP Performance Tracking</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={fetchAllData} style={{ padding: "10px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#889995" }}>
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 24, borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: 32 }}>
          <button onClick={() => setActiveTab("aum")} style={{ paddingBottom: 12, fontSize: 14, fontWeight: 700, borderBottom: activeTab === "aum" ? "2px solid #4ade80" : "none", color: activeTab === "aum" ? "#4ade80" : "#889995", background: "transparent", cursor: "pointer" }}>AUM Tracking</button>
          <button onClick={() => setActiveTab("sip")} style={{ paddingBottom: 12, fontSize: 14, fontWeight: 700, borderBottom: activeTab === "sip" ? "2px solid #4ade80" : "none", color: activeTab === "sip" ? "#4ade80" : "#889995", background: "transparent", cursor: "pointer" }}>SIP & Cashflow</button>
        </div>

        {/* Form Section */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: "#4ade80" }}>{isEditingStat ? "Edit Month Data" : "Log New Monthly Data"}</h3>
          <form onSubmit={handleSaveStat} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <div><label style={labelStyle}>Month</label><input type="month" value={statForm.monthId} onChange={e => setStatForm({...statForm, monthId: e.target.value})} style={inputStyle} disabled={isEditingStat} /></div>
            <div><label style={labelStyle}>AUM (54522)</label><input type="number" value={statForm.aum_54522} onChange={e => setStatForm({...statForm, aum_54522: e.target.value})} style={inputStyle} placeholder="₹" /></div>
            <div><label style={labelStyle}>AUM (340387)</label><input type="number" value={statForm.aum_340387} onChange={e => setStatForm({...statForm, aum_340387: e.target.value})} style={inputStyle} placeholder="₹" /></div>
            <div><label style={labelStyle}>Purchase</label><input type="number" value={statForm.purchase} onChange={e => setStatForm({...statForm, purchase: e.target.value})} style={inputStyle} placeholder="₹" /></div>
            <div><label style={labelStyle}>Redemption</label><input type="number" value={statForm.redemption} onChange={e => setStatForm({...statForm, redemption: e.target.value})} style={inputStyle} placeholder="₹" /></div>
            <div><label style={labelStyle}>Sensex</label><input type="number" value={statForm.sensex} onChange={e => setStatForm({...statForm, sensex: e.target.value})} style={inputStyle} placeholder="Points" /></div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button type="submit" style={{ flex: 1, padding: "10px", borderRadius: 8, background: "#008254", color: "white", border: "none", fontWeight: 700, cursor: "pointer" }}>Save</button>
              {isEditingStat && <button type="button" onClick={() => setIsEditingStat(false)} style={{ padding: "10px", borderRadius: 8, background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid #f87171" }}>Cancel</button>}
            </div>
          </form>
        </div>

        {activeTab === "aum" ? (
          <>
            {/* AUM Chart */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontWeight: 700 }}>AUM vs Sensex Trend</h3>
                <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", padding: "4px 8px", borderRadius: 6 }}>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="displayMonth" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} />
                  <YAxis yAxisId="left" tick={{ fill: "#4ade80", fontSize: 12 }} axisLine={false} tickFormatter={(v) => `₹${(v/10000000).toFixed(1)}Cr`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "#60a5fa", fontSize: 12 }} axisLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="totalAUM" stroke="#4ade80" strokeWidth={3} name="Total AUM" dot={{ r: 6 }} />
                  <Line yAxisId="right" type="monotone" dataKey="sensex" stroke="#60a5fa" strokeWidth={2} name="Sensex" strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* AUM Table */}
            <div style={{ ...cardStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#556660", fontSize: 10, textTransform: "uppercase" }}>
                    <th style={{ padding: 12, textAlign: "left" }}>Month</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Total AUM</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Change (₹)</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Growth (%)</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Sensex</th>
                    <th style={{ padding: 12, textAlign: "center" }}>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {[...monthlyStats].reverse().map(s => (
                    <tr key={s.monthId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: 12, fontWeight: 700 }}>{s.displayMonth}</td>
                      <td style={{ padding: 12, textAlign: "right" }}>₹{s.totalAUM.toLocaleString('en-IN')}</td>
                      <td style={{ padding: 12, textAlign: "right", color: s.aumChange >= 0 ? "#4ade80" : "#f87171" }}>{s.aumChange >= 0 ? "+" : ""}₹{Math.abs(s.aumChange).toLocaleString('en-IN')}</td>
                      <td style={{ padding: 12, textAlign: "right", color: s.aumChangePct >= 0 ? "#4ade80" : "#f87171" }}>{s.aumChangePct}%</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#60a5fa" }}>{s.sensex}</td>
                      <td style={{ padding: 12, textAlign: "center" }}>
                        <button onClick={() => { setStatForm(s); setIsEditingStat(true); }} style={{ background: "transparent", border: "none", color: "#889995", cursor: "pointer" }}><Pencil size={14}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {/* SIP Chart */}
            <div style={cardStyle}>
              <h3 style={{ fontWeight: 700, marginBottom: 20 }}>Cashflow & Cumulative Growth</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="displayMonth" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} />
                  <YAxis yAxisId="left" tick={{ fill: "#889995", fontSize: 12 }} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "#fbbf24", fontSize: 12 }} axisLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="purchase" fill="#60a5fa" name="Purchase" radius={[4,4,0,0]} />
                  <Bar yAxisId="left" dataKey="redemption" fill="#f87171" name="Redemption" radius={[4,4,0,0]} />
                  <Line yAxisId="right" type="stepAfter" dataKey="cumCashflow" stroke="#fbbf24" strokeWidth={3} name="Cum. Cashflow" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* SIP Table */}
            <div style={{ ...cardStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#556660", fontSize: 10, textTransform: "uppercase" }}>
                    <th style={{ padding: 12, textAlign: "left" }}>Month</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Purchase</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Redemption</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Net Cashflow</th>
                    <th style={{ padding: 12, textAlign: "right" }}>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {[...monthlyStats].reverse().map(s => (
                    <tr key={s.monthId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: 12, fontWeight: 700 }}>{s.displayMonth}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#60a5fa" }}>₹{s.purchase.toLocaleString('en-IN')}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#f87171" }}>₹{s.redemption.toLocaleString('en-IN')}</td>
                      <td style={{ padding: 12, textAlign: "right", color: s.netCashflow >= 0 ? "#4ade80" : "#f87171", fontWeight: 700 }}>₹{s.netCashflow.toLocaleString('en-IN')}</td>
                      <td style={{ padding: 12, textAlign: "right", color: "#fbbf24" }}>₹{s.cumCashflow.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

      </div>
    </div>
  );
}