import { useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isToday, parseISO, isSameDay, addWeeks, subWeeks, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, X, Star, Calendar as CalendarIcon } from "lucide-react";

// Firebase Imports
import { db } from "../firebase"; 
import { collection, query, onSnapshot, where } from "firebase/firestore";

const STATUS_COLOR = {
  "Pending":         "#fbbf24",
  "Under Process":   "#60a5fa",
  "Waiting Client":  "#a78bfa",
  "Completed":       "#4ade80",
  "Cancelled":       "#64748b",
};

// Combined Official + NSE Trading Holidays 2026
const INDIAN_HOLIDAYS_2026 = [
  { date: "2026-01-15", name: "Municipal Election - MH" },
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-02-15", name: "Mahashivratri" },
  { date: "2026-03-03", name: "Holi" },
  { date: "2026-03-21", name: "Id-Ul-Fitr (Ramadan Eid)" },
  { date: "2026-03-26", name: "Shri Ram Navami" },
  { date: "2026-03-31", name: "Shri Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-28", name: "Bakri Id" },
  { date: "2026-06-26", name: "Muharram" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-09-04", name: "Ganesh Chaturthi / Janmashtami" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-08", name: "Diwali Laxmi Pujan*" },
  { date: "2026-11-10", name: "Diwali-Balipratipada" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas" }
];

const RM_COLORS = ["#008254","#4ade80","#60a5fa","#fbbf24","#f87171","#a78bfa","#fb923c","#e879f9"];

function getDayData(tasks, date) {
  const dayTasks = tasks.filter(t => t.follow_up_date && isSameDay(parseISO(t.follow_up_date), date));
  const holiday = INDIAN_HOLIDAYS_2026.find(h => isSameDay(parseISO(h.date), date));
  return { dayTasks, holiday };
}

export default function CalendarView() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("month");
  const [current, setCurrent] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [selectedDayData, setSelectedDayData] = useState({ dayTasks: [], holiday: null });
  const [expandedTaskId, setExpandedTaskId] = useState(null); 

  // --- READ OPTIMIZATION: Fetch tasks based on the current calendar view window ---
  useEffect(() => {
    setLoading(true);
    
    // Create a 3-month window around the currently viewed month (Previous, Current, Next)
    // This allows the calendar to render trailing/leading days without loading 10 years of data.
    const windowStart = format(subMonths(current, 1), "yyyy-MM-01");
    const windowEnd = format(addMonths(current, 2), "yyyy-MM-01");

    const tasksRef = collection(db, "tasks");
    
    // We only need Active tasks for the calendar view (you don't usually track completed tasks in a calendar planner)
    const q = query(
      tasksRef, 
      where("status", "in", ["Pending", "Under Process", "Waiting Client"]),
      where("follow_up_date", ">=", windowStart),
      where("follow_up_date", "<=", windowEnd)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(taskData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching tasks for calendar:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [current]); // Refetch if the user navigates to a drastically different month

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
    setExpandedTaskId(null); 
    setSelectedDayData(getDayData(tasks, date));
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
      <div className="select-none">
        <div className="grid grid-cols-7 mb-2">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => (
            <div key={day} className="text-center text-[10px] font-bold text-[#556660] uppercase tracking-wider py-2">{day}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              const { dayTasks, holiday } = getDayData(tasks, day);
              const inMonth = isSameMonth(day, current);
              const isT = isToday(day);
              const rmCounts = {};
              dayTasks.forEach(t => { if (t.assigned_to) rmCounts[t.assigned_to] = (rmCounts[t.assigned_to] || 0) + 1; });

              return (
                <div
                  key={di}
                  onClick={() => openDay(day)}
                  style={{
                    minHeight: 110, padding: "10px", borderRadius: 12, cursor: "pointer",
                    background: holiday ? "rgba(248,113,113,0.05)" : isT ? "rgba(0,130,84,0.12)" : inMonth ? "rgba(255,255,255,0.02)" : "transparent",
                    border: holiday ? "1px solid rgba(248,113,113,0.2)" : isT ? "1px solid rgba(0,130,84,0.4)" : "1px solid rgba(255,255,255,0.05)",
                    opacity: inMonth ? 1 : 0.3,
                  }}
                  className="transition-all hover:bg-white/5"
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-bold" style={{ color: holiday ? "#f87171" : isT ? "#4ade80" : inMonth ? "#c8d4d0" : "#556660" }}>
                      {format(day, "d")}
                    </span>
                    {holiday && <Star className="w-3 h-3 text-[#f87171] fill-[#f87171]/20" />}
                  </div>
                  
                  {holiday && (
                    <div className="mb-2">
                      <p className="text-[7px] font-black text-[#f87171] uppercase leading-none mb-0.5">National Holiday</p>
                      <p className="text-[9px] text-[#f87171]/80 truncate leading-tight font-medium" title={holiday.name}>{holiday.name}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    {Object.entries(rmCounts).slice(0, 2).map(([rm, cnt]) => (
                      <div key={rm} className="flex items-center gap-1.5 text-[10px]">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: rmColorMap[rm] || "#008254" }} />
                        <span className="text-[#889995] truncate">{rm.split(" ")[0]} ({cnt})</span>
                      </div>
                    ))}
                    {dayTasks.length > 2 && <p className="text-[9px] text-[#556660] pl-3">+{dayTasks.length - 2} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const renderWeek = () => {
    const weekStart = startOfWeek(current, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (
      <div className="grid grid-cols-7 gap-4">
        {days.map((day, i) => {
          const { dayTasks, holiday } = getDayData(tasks, day);
          const isT = isToday(day);
          return (
            <div key={i} className={`p-4 rounded-2xl min-h-[300px] border transition-all ${isT ? 'bg-brand-green/5 border-brand-green/30' : 'bg-white/5 border-white/10'}`}>
              <div className="mb-4">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${holiday ? 'text-red-400' : 'text-white/40'}`}>{format(day, "EEE")}</p>
                <p className={`text-2xl font-black ${holiday ? 'text-red-400' : isT ? 'text-brand-green' : 'text-white'}`}>{format(day, "d")}</p>
                {holiday && <p className="text-[9px] font-bold text-red-400/80 mt-1 uppercase leading-tight">{holiday.name}</p>}
              </div>
              <div className="space-y-2">
                {dayTasks.map(t => (
                  <div key={t.id} onClick={() => openDay(day)} className="p-2 rounded-lg bg-white/5 border border-white/5 cursor-pointer hover:border-brand-green/50 transition-colors">
                    <p className="text-[9px] font-bold text-brand-green truncate">{t.assigned_to?.split(" ")[0]}</p>
                    <p className="text-[10px] text-white/80 truncate">{t.client_name}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDay = () => {
    const { dayTasks, holiday } = getDayData(tasks, current);
    return (
      <div className="space-y-6">
        {holiday && (
          <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-4">
            <Star className="w-8 h-8 text-red-500 fill-red-500/20" />
            <div>
              <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em]">National Holiday</p>
              <h2 className="text-2xl font-black text-white">{holiday.name}</h2>
            </div>
          </div>
        )}
        {dayTasks.length === 0 && !holiday ? (
          <div className="text-center py-20 text-white/20">No tasks scheduled for this day.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dayTasks.map(t => (
              <div key={t.id} className="glass-surface p-5 border-l-4" style={{ borderLeftColor: rmColorMap[t.assigned_to] }}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-mono font-bold text-brand-green">{t.task_id}</span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${t.status === 'Completed' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                    {t.status}
                  </span>
                </div>
                <p className="text-sm font-bold text-white mb-1">{t.client_name}</p>
                <p className="text-xs text-white/40">{t.assigned_to} • {t.action}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-8 space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">Calendar</h1>
          <p className="text-brand-green text-xs font-bold uppercase tracking-widest mt-1">RM Workload & Trading Holiday Planner</p>
        </div>
        
        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
          {["day", "week", "month"].map(v => (
            <button key={v}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${view === v ? 'bg-brand-green text-white shadow-lg' : 'text-white/40 hover:text-white'}`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => nav(-1)} className="p-2 glass-surface rounded-full hover:bg-white/10 transition-colors"><ChevronLeft className="w-5 h-5"/></button>
          <h2 className="text-xl font-black text-white min-w-[200px] text-center">{headerLabel()}</h2>
          <button onClick={() => nav(1)} className="p-2 glass-surface rounded-full hover:bg-white/10 transition-colors"><ChevronRight className="w-5 h-5"/></button>
        </div>
        <button onClick={() => setCurrent(new Date())} className="px-4 py-2 glass-surface text-[10px] font-bold uppercase tracking-widest hover:border-brand-green transition-all">Today</button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-white/20 font-bold uppercase tracking-[0.3em] animate-pulse">Synchronizing Planner...</div>
      ) : (
        <div className="glass-surface p-6 backdrop-blur-3xl bg-brand-black/40">
          {view === "month" && renderMonth()}
          {view === "week" && renderWeek()}
          {view === "day" && renderDay()}
        </div>
      )}

      {/* Selected Day Modal */}
      {selected && view !== "day" && (
        <div 
          className="fixed inset-0 bg-brand-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" 
          onClick={() => { setSelected(null); setExpandedTaskId(null); }}
        >
          <div className="glass-surface max-w-xl w-full p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setSelected(null); setExpandedTaskId(null); }} className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors">
              <X />
            </button>
            
            <div className="mb-8">
              <h3 className="text-2xl font-black text-white">{format(selected, "do MMMM, yyyy")}</h3>
              {selectedDayData.holiday && (
                <div className="mt-3 flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full w-fit">
                  <Star className="w-3 h-3 text-red-500 fill-red-500" />
                  <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">National Holiday: {selectedDayData.holiday.name}</span>
                </div>
              )}
            </div>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {selectedDayData.dayTasks.length > 0 ? (
                selectedDayData.dayTasks.map(t => {
                  const isExpanded = expandedTaskId === t.id;
                  return (
                    <div 
                      key={t.id} 
                      className={`p-4 rounded-xl border border-white/10 border-l-4 transition-all cursor-pointer ${isExpanded ? 'bg-white/10 ring-1 ring-brand-green/30' : 'bg-white/5 hover:bg-white/10'}`} 
                      style={{ borderLeftColor: rmColorMap[t.assigned_to] }}
                      onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-sm font-bold text-white">{t.client_name}</p>
                        <span className="text-[9px] font-mono font-bold text-brand-green">{t.task_id}</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span 
                          className="text-[8px] font-black px-1.5 py-0.5 rounded-sm uppercase" 
                          style={{ background: `${STATUS_COLOR[t.status]}20`, color: STATUS_COLOR[t.status] }}
                        >
                          {t.status}
                        </span>
                        <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider">{t.assigned_to} • {t.action}</p>
                      </div>

                      {/* Expanded Section */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[8px] font-bold text-[#556660] uppercase mb-1">Category</p>
                              <p className="text-xs text-white/80">{t.category}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-bold text-[#556660] uppercase mb-1">Amount</p>
                              <p className="text-xs text-brand-green font-bold">₹{t.amount || "0"}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-bold text-[#556660] uppercase mb-1">Channel</p>
                              <p className="text-xs text-white/80">{t.channel || "Not Specified"}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-bold text-[#556660] uppercase mb-1">Priority</p>
                              <p className="text-xs text-white/80">{t.priority}</p>
                            </div>
                          </div>
                          {t.notes && (
                            <div className="bg-brand-black/40 p-3 rounded-lg">
                              <p className="text-[8px] font-bold text-[#556660] uppercase mb-1">Notes</p>
                              <p className="text-xs text-white/60 italic leading-relaxed">{t.notes}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-white/20 italic text-center py-10">No client service tasks assigned for this date.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}