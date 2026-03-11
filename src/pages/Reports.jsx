const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState, useEffect } from "react";

import { format, parseISO, startOfMonth, subMonths, differenceInDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";

const COLORS = ["#008254", "#4ade80", "#60a5fa", "#fbbf24", "#f87171", "#a78bfa"];

const tooltipStyle = {
  contentStyle: { background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#c8d4d0", fontSize: 12 },
  labelStyle: { color: "#889995" },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};

const cardStyle = { background: "#0a1612", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24 };

export default function Reports() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.entities.Task.list("-entry_date", 1000).then(data => { setTasks(data); setLoading(false); });
  }, []);

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i);
    const label = format(d, "MMM yy");
    const ms = startOfMonth(d);
    const me = startOfMonth(subMonths(d, -1));
    const created = tasks.filter(t => t.entry_date && parseISO(t.entry_date) >= ms && parseISO(t.entry_date) < me).length;
    const done = tasks.filter(t => t.closure_date && parseISO(t.closure_date) >= ms && parseISO(t.closure_date) < me).length;
    return { label, created, done };
  });

  const closedTasks = tasks.filter(t => t.status === "Completed" && t.entry_date && t.closure_date);
  const avgClosure = closedTasks.length > 0
    ? (closedTasks.reduce((sum, t) => sum + differenceInDays(parseISO(t.closure_date), parseISO(t.entry_date)), 0) / closedTasks.length).toFixed(1)
    : "—";

  const byEmp = {};
  tasks.forEach(t => { if (t.assigned_to) byEmp[t.assigned_to] = (byEmp[t.assigned_to] || 0) + 1; });
  const empData = Object.entries(byEmp).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const byBranch = {};
  tasks.forEach(t => { if (t.branch) byBranch[t.branch] = (byBranch[t.branch] || 0) + 1; });
  const branchData = Object.entries(byBranch).map(([name, value]) => ({ name, value }));

  const byCat = {};
  tasks.forEach(t => { if (t.category) byCat[t.category] = (byCat[t.category] || 0) + 1; });
  const catData = Object.entries(byCat).map(([name, value]) => ({ name, value }));

  const byStatus = {};
  tasks.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
  const statusData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));

  if (loading) return (
    <div style={{ background: "var(--bg-black)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#889995" }}>
      Loading reports...
    </div>
  );

  const kpis = [
    { label: "Total Tasks", value: tasks.length, color: "#c8d4d0" },
    { label: "Completed", value: closedTasks.length, color: "#4ade80" },
    { label: "Avg Closure Time", value: `${avgClosure} days`, color: "#60a5fa" },
    { label: "Active Tasks", value: tasks.filter(t => !["Completed", "Cancelled"].includes(t.status)).length, color: "#fbbf24" },
  ];

  return (
    <div style={{ background: "var(--bg-black)", minHeight: "100vh", padding: "28px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#c8d4d0" }}>Reports & Analytics</h1>
          <p style={{ fontSize: 13, color: "#889995", marginTop: 4 }}>Performance overview across all tasks</p>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
          {kpis.map(s => (
            <div key={s.label} style={cardStyle}>
              <p style={{ fontSize: 28, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
              <p style={{ fontSize: 12, color: "#889995", marginTop: 6 }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Monthly trend */}
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Monthly Tasks — Created vs Completed</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#889995" }} />
              <Bar dataKey="created" fill="#008254" radius={[4, 4, 0, 0]} name="Created" />
              <Bar dataKey="done" fill="#4ade80" radius={[4, 4, 0, 0]} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Emp + Branch */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={cardStyle}>
            <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Tasks per Employee</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={empData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#889995" }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#889995" }} width={90} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" fill="#008254" radius={[0, 4, 4, 0]} name="Tasks" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={cardStyle}>
            <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Tasks per Branch</h3>
            <ResponsiveContainer width="100%" height={220}>
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

        {/* Category + Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={cardStyle}>
            <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Tasks by Category</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={catData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={{ stroke: "rgba(255,255,255,0.15)" }}>
                  {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={cardStyle}>
            <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Status Breakdown</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                  {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#889995" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Employee table */}
        <div style={cardStyle}>
          <h3 style={{ fontWeight: 600, color: "#c8d4d0", marginBottom: 16 }}>Employee Performance Summary</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  {["Employee", "Total", "Completed", "Active", "Completion %"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#556660" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {empData.map(({ name }) => {
                  const empTasks = tasks.filter(t => t.assigned_to === name);
                  const done = empTasks.filter(t => t.status === "Completed").length;
                  const active = empTasks.filter(t => !["Completed", "Cancelled"].includes(t.status)).length;
                  const pct = empTasks.length > 0 ? Math.round((done / empTasks.length) * 100) : 0;
                  return (
                    <tr key={name} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "12px 12px", fontWeight: 500, color: "#c8d4d0" }}>{name}</td>
                      <td style={{ padding: "12px 12px", color: "#889995" }}>{empTasks.length}</td>
                      <td style={{ padding: "12px 12px", color: "#4ade80" }}>{done}</td>
                      <td style={{ padding: "12px 12px", color: "#60a5fa" }}>{active}</td>
                      <td style={{ padding: "12px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, background: "rgba(255,255,255,0.06)", borderRadius: 99, height: 4 }}>
                            <div style={{ background: "#008254", borderRadius: 99, height: 4, width: `${pct}%`, transition: "width 0.4s" }} />
                          </div>
                          <span style={{ fontSize: 11, color: "#889995", minWidth: 30 }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}