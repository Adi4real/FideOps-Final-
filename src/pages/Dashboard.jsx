import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  CheckCircle2, Clock, AlertTriangle, CalendarClock,
  TrendingUp, Users, UserPlus, ArrowRight, ClipboardCheck, AlertCircle
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";
import { format, isToday, isPast, parseISO, startOfMonth, subMonths, endOfMonth } from "date-fns";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, where } from "firebase/firestore";

const COLORS = ["#008254", "#4ade80", "#60a5fa", "#fbbf24", "#f87171"];

const tooltipStyle = {
  contentStyle: { background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#c8d4d0" },
  labelStyle: { color: "#889995" },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};

// --- GLOBAL MEMORY CACHE (0 READS ON TAB SWITCH) ---
let cachedTasks = [];
let cachedLeads = [];
let cachedClients = [];
let isListeningT = false;
let isListeningL = false;
let isListeningC = false;
let subsT = new Set();
let subsL = new Set();
let subsC = new Set();

export default function Dashboard() {
  const [tasks, setTasks] = useState(cachedTasks);
  const [leads, setLeads] = useState(cachedLeads);
  const [clients, setClients] = useState(cachedClients);
  const [loading, setLoading] = useState(cachedTasks.length === 0 || cachedClients.length === 0);

  // Filter for Review Metrics
  const [reviewMonth, setReviewMonth] = useState(format(new Date(), "yyyy-MM"));

  // --- SMART CACHED FETCH ---
  useEffect(() => {
    subsT.add(setTasks);
    subsL.add(setLeads);
    subsC.add(setClients);

    const sixMonthsAgoStr = format(subMonths(new Date(), 5), "yyyy-MM-01");
    const sixMonthsAgoDate = new Date(sixMonthsAgoStr);

    if (!isListeningT) {
      isListeningT = true;
      const qTasks = query(collection(db, "tasks"), where("entry_date", ">=", sixMonthsAgoStr));
      onSnapshot(qTasks, (snap) => {
        cachedTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        subsT.forEach(cb => cb(cachedTasks));
      });
    }

    if (!isListeningL) {
      isListeningL = true;
      const qLeads = query(collection(db, "leads"), where("created_at", ">=", sixMonthsAgoDate));
      onSnapshot(qLeads, (snap) => {
        cachedLeads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        subsL.forEach(cb => cb(cachedLeads));
      }, (err) => {
        console.warn("Leads index missing, fetching active only.", err);
        onSnapshot(collection(db, "leads"), snap => {
          cachedLeads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          subsL.forEach(cb => cb(cachedLeads));
        });
      });
    }

    if (!isListeningC) {
      isListeningC = true;
      onSnapshot(collection(db, "clients"), (snap) => {
        cachedClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        subsC.forEach(cb => cb(cachedClients));
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    return () => { 
      subsT.delete(setTasks); 
      subsL.delete(setLeads); 
      subsC.delete(setClients); 
    };
  }, []);

  // --- TASK METRICS ---
  const active = tasks.filter(t => !["Completed", "Cancelled"].includes(t.status));
  const completed = tasks.filter(t => t.status === "Completed");
  const overdue = active.filter(t => t.follow_up_date && isPast(parseISO(t.follow_up_date)) && !isToday(parseISO(t.follow_up_date)));
  const todayFollowups = active.filter(t => t.follow_up_date && isToday(parseISO(t.follow_up_date)));
  
  // --- LEAD METRICS ---
  const activeLeads = leads.filter(l => l.status !== "Converted");
  const convertedLeads = leads.filter(l => l.status === "Converted");

  // --- REVIEW METRICS ---
  const unscheduledReviews = clients.filter(c => !c.next_review_date).length;
  
  // Completed in selected month (Checks the review timeline logs)
  const completedReviewsThisMonth = clients.filter(c => 
    (c.review_notes || []).some(n => n.date.startsWith(reviewMonth) && n.text.includes("Review Completed"))
  ).length;

  // Pending for selected month (next_review_date is on or before the end of the selected month)
  const endOfSelectedMonthStr = `${reviewMonth}-31`; // Safe string comparison boundary
  const pendingReviewsThisMonth = clients.filter(c => 
    c.next_review_date && c.next_review_date <= endOfSelectedMonthStr
  ).length;

  const totalReviewsThisMonth = pendingReviewsThisMonth + completedReviewsThisMonth;

  // --- CHARTS DATA ---
  const byEmployee = {};
  tasks.forEach(t => { if (t.assigned_to) byEmployee[t.assigned_to] = (byEmployee[t.assigned_to] || 0) + 1; });
  const employeeData = Object.entries(byEmployee).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);

  const byBranch = {};
  tasks.forEach(t => { if (t.branch) byBranch[t.branch] = (byBranch[t.branch] || 0) + 1; });
  const branchData = Object.entries(byBranch).map(([name, value]) => ({ name, value }));

  const byCat = {};
  tasks.forEach(t => { if (t.category) byCat[t.category] = (byCat[t.category] || 0) + 1; });
  const catData = Object.entries(byCat).map(([name, value]) => ({ name, value }));

  const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i);
    const label = format(d, "MMM");
    const monthStart = startOfMonth(d);
    const monthEnd = startOfMonth(subMonths(d, -1));
    const created = tasks.filter(t => { const ed = t.entry_date ? parseISO(t.entry_date) : null; return ed && ed >= monthStart && ed < monthEnd; }).length;
    const done = tasks.filter(t => { const cd = t.closure_date ? parseISO(t.closure_date) : null; return cd && cd >= monthStart && cd < monthEnd; }).length;
    return { label, created, done };
  });

  const cardBase = { background: "var(--glass)", border: "1px solid var(--border)", borderRadius: 16, backdropFilter: "blur(10px)" };

  const stats = [
    { label: "Tasks (Last 6M)", value: tasks.length, icon: TrendingUp, color: "#008254" },
    { label: "Completed", value: completed.length, icon: CheckCircle2, color: "#4ade80" },
    { label: "Active Tasks", value: active.length, icon: Clock, color: "#60a5fa" },
    { label: "Overdue", value: overdue.length, icon: AlertTriangle, color: "#f87171" },
    { label: "Today's Follow-ups", value: todayFollowups.length, icon: CalendarClock, color: "#fbbf24" },
  ];

  const bdStats = [
    { label: "Active Leads", value: activeLeads.length, icon: UserPlus, color: "#a78bfa" },
    { label: "Converted Clients", value: convertedLeads.length, icon: Users, color: "#4ade80" },
  ];

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-[#889995]">
      Loading dashboard data...
    </div>
  );

  return (
    <div className="p-4 lg:p-8 space-y-8" style={{ background: "var(--bg-black)", minHeight: "100vh" }}>
      <style>{`
        input[type="month"]::-webkit-calendar-picker-indicator {
          filter: invert(83%) sepia(51%) saturate(1149%) hue-rotate(339deg) brightness(101%) contrast(105%);
          cursor: pointer;
        }
        input[type="month"] {
          color-scheme: dark;
          color: #fbbf24 !important; 
          font-weight: 700;
        }
      `}</style>
      
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "#c8d4d0" }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: "#889995" }}>Overview of operations (Last 6 Months)</p>
      </div>

      {/* BD Stats */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, color: "#008254", background: "rgba(0,130,84,0.12)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(0,130,84,0.25)" }}>Business Development</span>
          <Link to={createPageUrl("LeadClients")} style={{ fontSize: 11, color: "#4ade80", display: "flex", alignItems: "center", gap: 4 }}>View Leads <ArrowRight className="w-3 h-3" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {bdStats.map(s => (
            <div key={s.label} style={{ ...cardBase, padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: `${s.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <s.icon style={{ width: 20, height: 20, color: s.color }} />
              </div>
              <div>
                <p style={{ fontSize: 26, fontWeight: 800, color: "#c8d4d0", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: 12, color: "#889995", marginTop: 4 }}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Task Stats */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(96,165,250,0.2)" }}>Existing Clients</span>
          <Link to={createPageUrl("LiveTasks")} style={{ fontSize: 11, color: "#60a5fa", display: "flex", alignItems: "center", gap: 4 }}>View Tasks <ArrowRight className="w-3 h-3" /></Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {stats.map(s => (
            <div key={s.label} style={{ ...cardBase, padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${s.color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <s.icon style={{ width: 18, height: 18, color: s.color }} />
              </div>
              <div>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#c8d4d0", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: 11, color: "#889995", marginTop: 3 }}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- NEW SECTION: CLIENT REVIEW METRICS --- */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, color: "#fbbf24", background: "rgba(251,191,36,0.1)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(251,191,36,0.2)" }}>Client Review Tracker</span>
            <Link to={createPageUrl("ClientReview")} style={{ fontSize: 11, color: "#fbbf24", display: "flex", alignItems: "center", gap: 4 }}>Review Dashboard <ArrowRight className="w-3 h-3" /></Link>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "4px 10px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#889995", uppercase: true, marginRight: "8px" }}>Filter: </span>
            <input 
              type="month" 
              value={reviewMonth} 
              onChange={e => setReviewMonth(e.target.value)} 
              style={{ background: "transparent", border: "none", outline: "none", fontSize: "12px" }} 
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* LINK TO CLIENT REVIEW PAGE WITH FILTER STATE */}
          <Link to={createPageUrl("ClientReview")} state={{ filterStatus: "unscheduled" }} style={{ textDecoration: "none" }} className="hover:scale-[1.02] transition-transform">
            <div style={{ ...cardBase, padding: 20, display: "flex", alignItems: "center", gap: 16 }} className="hover:border-[#f87171] hover:bg-white/5 transition-all">
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(248,113,113,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <AlertCircle style={{ width: 20, height: 20, color: "#f87171" }} />
              </div>
              <div>
                <p style={{ fontSize: 26, fontWeight: 800, color: "#c8d4d0", lineHeight: 1 }}>{unscheduledReviews}</p>
                <p style={{ fontSize: 12, color: "#889995", marginTop: 4 }}>Unscheduled Reviews</p>
              </div>
            </div>
          </Link>

          <div style={{ ...cardBase, padding: 20, display: "flex", alignItems: "center", gap: 16, border: "1px solid rgba(96,165,250,0.3)" }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(96,165,250,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ClipboardCheck style={{ width: 20, height: 20, color: "#60a5fa" }} />
            </div>
            <div>
              <p style={{ fontSize: 26, fontWeight: 800, color: "#60a5fa", lineHeight: 1 }}>
                {pendingReviewsThisMonth} <span style={{fontSize: 12, color: "#889995", fontWeight: 600}}>/ {totalReviewsThisMonth}</span>
              </p>
              <p style={{ fontSize: 12, color: "#889995", marginTop: 4 }}>Pending Due For {format(new Date(`${reviewMonth}-01`), "MMMM")}</p>
            </div>
          </div>

          <div style={{ ...cardBase, padding: 20, display: "flex", alignItems: "center", gap: 16, border: "1px solid rgba(74,222,128,0.3)" }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(74,222,128,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 style={{ width: 20, height: 20, color: "#4ade80" }} />
            </div>
            <div>
              <p style={{ fontSize: 26, fontWeight: 800, color: "#4ade80", lineHeight: 1 }}>{completedReviewsThisMonth}</p>
              <p style={{ fontSize: 12, color: "#889995", marginTop: 4 }}>Completed In {format(new Date(`${reviewMonth}-01`), "MMMM")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div style={{ ...cardBase, padding: 24 }}>
          <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Monthly Task Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#889995" }} />
              <Line type="monotone" dataKey="created" stroke="#008254" strokeWidth={2} name="Created" dot={false} />
              <Line type="monotone" dataKey="done" stroke="#4ade80" strokeWidth={2} name="Completed" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ ...cardBase, padding: 24 }}>
          <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Team Productivity</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={employeeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#889995" }} width={80} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="#008254" radius={[0, 4, 4, 0]} name="Tasks" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div style={{ ...cardBase, padding: 24 }}>
          <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Tasks by Category</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={catData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#889995" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ ...cardBase, padding: 24, gridColumn: "span 2" }}>
          <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Branch Workload</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={branchData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="value" fill="#4ade80" radius={[4, 4, 0, 0]} name="Tasks" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Today's follow-ups */}
      {todayFollowups.length > 0 && (
        <div style={{ ...cardBase, padding: 24 }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontWeight: 600, color: "#c8d4d0" }}>Today's Follow-ups</h3>
            <Link to={createPageUrl("LiveTasks")} style={{ fontSize: 12, color: "#4ade80", display: "flex", alignItems: "center", gap: 4 }}>
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {todayFollowups.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fbbf24", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: "#c8d4d0", flex: 1 }}>{t.task_id} — {t.client_name}</span>
                <span style={{ fontSize: 12, color: "#889995" }}>{t.action}</span>
                <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: "rgba(245,158,11,0.15)", color: "#fbbf24", fontWeight: 600 }}>{t.assigned_to}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}