const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState, useEffect } from "react";

import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isToday, parseISO, isSameDay, addWeeks, subWeeks, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

const STATUS_COLOR = {
  "Pending":        "#fbbf24",
  "Under Process":  "#60a5fa",
  "Waiting Client": "#a78bfa",
  "Completed":      "#4ade80",
  "Cancelled":      "#64748b",
};

const RM_COLORS = ["#008254","#4ade80","#60a5fa","#fbbf24","#f87171","#a78bfa","#fb923c","#e879f9"];

function getDayTasks(tasks, date) {
  return tasks.filter(t => t.follow_up_date && isSameDay(parseISO(t.follow_up_date), date));
}

export default function CalendarView() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("month"); // month | week | day
  const [current, setCurrent] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [selectedDayTasks, setSelectedDayTasks] = useState([]);

  useEffect(() => {
    db.entities.Task.list("-follow_up_date", 1000).then(d => { setTasks(d); setLoading(false); });
  }, []);

  const allRMs = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];
  const rmColorMap = {};
  allRMs.forEach((rm, i) => { rmColorMap[rm] = RM_COLORS[i % RM_COLORS.length]; });

  const nav = (dir) => {
    if (view === "month") setCurrent(dir > 0 ? addMonths(current, 1) : subMonths(current, 1));
    else if (view === "week") setCurrent(dir > 0 ? addWeeks(current, 1) : subWeeks(current, 1));
    else setCurrent(addDays(current, dir));
  };

  const openDay = (date) => {
    setSelected(date);
    setSelectedDayTasks(getDayTasks(tasks, date));
  };

  const headerLabel = () => {
    if (view === "month") return format(current, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(current, { weekStartsOn: 1 });
      const we = endOfWeek(current, { weekStartsOn: 1 });
      return `${format(ws, "d MMM")} – ${format(we, "d MMM yyyy")}`;
    }
    return format(current, "EEEE, d MMMM yyyy");
  };

  // Month grid
  const renderMonth = () => {
    const monthStart = startOfMonth(current);
    const monthEnd = endOfMonth(current);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = [];
    let d = gridStart;
    while (d <= gridEnd) { days.push(d); d = addDays(d, 1); }
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => (
            <div key={day} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase", letterSpacing: 1, padding: "8px 0" }}>{day}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {week.map((day, di) => {
              const dayTasks = getDayTasks(tasks, day);
              const inMonth = isSameMonth(day, current);
              const isT = isToday(day);
              const rmCounts = {};
              dayTasks.forEach(t => { if (t.assigned_to) rmCounts[t.assigned_to] = (rmCounts[t.assigned_to] || 0) + 1; });

              return (
                <div
                  key={di}
                  onClick={() => openDay(day)}
                  style={{
                    minHeight: 80, padding: "6px 8px", borderRadius: 10, cursor: "pointer",
                    background: isT ? "rgba(0,130,84,0.12)" : inMonth ? "rgba(255,255,255,0.02)" : "transparent",
                    border: isT ? "1px solid rgba(0,130,84,0.4)" : "1px solid rgba(255,255,255,0.05)",
                    opacity: inMonth ? 1 : 0.35,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isT ? "rgba(0,130,84,0.2)" : "rgba(255,255,255,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = isT ? "rgba(0,130,84,0.12)" : inMonth ? "rgba(255,255,255,0.02)" : "transparent"}
                >
                  <div style={{ fontSize: 12, fontWeight: isT ? 800 : 400, color: isT ? "#4ade80" : inMonth ? "#c8d4d0" : "#556660", marginBottom: 4 }}>
                    {format(day, "d")}
                  </div>
                  {dayTasks.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {Object.entries(rmCounts).slice(0, 3).map(([rm, cnt]) => (
                        <div key={rm} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, overflow: "hidden" }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: rmColorMap[rm] || "#008254", flexShrink: 0 }} />
                          <span style={{ color: "#889995", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rm.split(" ")[0]} ({cnt})</span>
                        </div>
                      ))}
                      {dayTasks.length > 3 && <div style={{ fontSize: 10, color: "#556660" }}>+{dayTasks.length - 3} more</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // Week view
  const renderWeek = () => {
    const weekStart = startOfWeek(current, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
        {days.map((day, i) => {
          const dayTasks = getDayTasks(tasks, day);
          const isT = isToday(day);
          return (
            <div key={i} style={{ background: isT ? "rgba(0,130,84,0.08)" : "rgba(255,255,255,0.02)", border: isT ? "1px solid rgba(0,130,84,0.3)" : "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, minHeight: 200 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#556660", textTransform: "uppercase" }}>{format(day, "EEE")}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: isT ? "#4ade80" : "#c8d4d0" }}>{format(day, "d")}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {dayTasks.map(t => (
                  <div key={t.id} onClick={() => openDay(day)} style={{ padding: "5px 8px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: `1px solid ${rmColorMap[t.assigned_to] || "#008254"}33`, cursor: "pointer" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: rmColorMap[t.assigned_to] || "#4ade80", marginBottom: 1 }}>{t.assigned_to?.split(" ")[0]}</div>
                    <div style={{ fontSize: 11, color: "#c8d4d0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.client_name}</div>
                    <div style={{ fontSize: 10, color: STATUS_COLOR[t.status] || "#889995" }}>{t.status}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Day view
  const renderDay = () => {
    const dayTasks = getDayTasks(tasks, current);
    const rmGroups = {};
    dayTasks.forEach(t => {
      if (!rmGroups[t.assigned_to || "Unassigned"]) rmGroups[t.assigned_to || "Unassigned"] = [];
      rmGroups[t.assigned_to || "Unassigned"].push(t);
    });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {dayTasks.length === 0 && <div style={{ textAlign: "center", padding: 60, color: "#889995" }}>No tasks scheduled for this day.</div>}
        {Object.entries(rmGroups).map(([rm, rmTasks]) => (
          <div key={rm}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: rmColorMap[rm] || "#008254" }} />
              <span style={{ fontWeight: 600, fontSize: 13, color: "#c8d4d0" }}>{rm}</span>
              <span style={{ fontSize: 11, color: "#889995" }}>({rmTasks.length} tasks)</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rmTasks.map(t => (
                <div key={t.id} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, borderLeft: `3px solid ${STATUS_COLOR[t.status] || "#008254"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#008254" }}>{t.task_id}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#c8d4d0" }}>{t.client_name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px", borderRadius: 6, background: `${STATUS_COLOR[t.status]}22`, color: STATUS_COLOR[t.status] || "#889995" }}>{t.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#889995" }}>{t.category} · {t.action}</div>
                  {t.notes && <div style={{ fontSize: 11, color: "#556660", marginTop: 4, fontStyle: "italic" }}>{t.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const btnStyle = (active) => ({
    padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? "#008254" : "rgba(255,255,255,0.04)",
    color: active ? "white" : "#889995",
    border: active ? "none" : "1px solid rgba(255,255,255,0.08)",
    cursor: "pointer",
  });

  return (
    <div style={{ background: "var(--bg-black)", minHeight: "100vh", padding: "28px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#c8d4d0" }}>Calendar</h1>
            <p style={{ fontSize: 13, color: "#889995", marginTop: 4 }}>RM workload planner</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {["day","week","month"].map(v => <button key={v} style={btnStyle(view === v)} onClick={() => setView(v)}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={() => nav(-1)} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#889995", cursor: "pointer" }}><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setCurrent(new Date())} style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#c8d4d0", fontSize: 12, cursor: "pointer" }}>Today</button>
              <button onClick={() => nav(1)} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#889995", cursor: "pointer" }}><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {/* Current label */}
        <div style={{ fontSize: 16, fontWeight: 700, color: "#c8d4d0", marginBottom: 16 }}>{headerLabel()}</div>

        {/* RM legend */}
        {allRMs.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {allRMs.map(rm => (
              <div key={rm} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: rmColorMap[rm] }} />
                <span style={{ fontSize: 11, color: "#889995" }}>{rm}</span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#889995" }}>Loading...</div>
        ) : (
          <div style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 }}>
            {view === "month" && renderMonth()}
            {view === "week" && renderWeek()}
            {view === "day" && renderDay()}
          </div>
        )}

        {/* Day modal */}
        {selected && view !== "day" && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setSelected(null)}>
            <div style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: 28, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontWeight: 700, fontSize: 16, color: "#c8d4d0" }}>{format(selected, "EEEE, d MMMM yyyy")}</h3>
                <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#889995", cursor: "pointer" }}><X className="w-5 h-5" /></button>
              </div>
              {selectedDayTasks.length === 0 ? (
                <p style={{ color: "#889995", fontSize: 13 }}>No tasks scheduled for this day.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {selectedDayTasks.map(t => (
                    <div key={t.id} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, borderLeft: `3px solid ${rmColorMap[t.assigned_to] || "#008254"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#008254" }}>{t.task_id}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#c8d4d0" }}>{t.client_name}</span>
                        <span style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px", borderRadius: 6, background: `${STATUS_COLOR[t.status]}22`, color: STATUS_COLOR[t.status] || "#889995" }}>{t.status}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#889995" }}>{t.assigned_to} · {t.category} · {t.action}</div>
                      {t.notes && <div style={{ fontSize: 11, color: "#556660", marginTop: 4 }}>{t.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}