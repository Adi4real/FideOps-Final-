import { db, auth } from "./firebase";
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns"; // <-- THIS WAS MISSING!

import {
  LayoutDashboard, Plus, Users, ListChecks, BarChart3, Calendar,
  Menu, X, LogOut, ArrowLeft, TrendingUp, TrendingDown, Activity, CheckCircle2, ClipboardCheck,
  Goal
} from "lucide-react";
import { cn } from "@/lib/utils";
import { collection, query, onSnapshot, where } from "firebase/firestore";

const navGroups = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", icon: LayoutDashboard, page: "Dashboard" },
        { label: "Calendar", icon: Calendar, page: "CalendarView" }
    ],
  },
  {
    label: "Client Management",
    items: [{ label: "Lead Clients", icon: Users, page: "LeadClients" },
              { label: "Clients", icon: Users, page: "Clients" }
    ],
  },
  {
    label: "Workflow & Tasks",
    items: [
      { label: "Live Tasks", icon: ListChecks, page: "LiveTasks" },
      { label: "New Task", icon: Plus, page: "NewTask" }
      
    ],
  },
  {
    label: "Financial Planning",
    items: [
      { label: "Goal Tracker", icon: Goal, page: "LiveTasks" },
      { label: "Client Review", icon: ClipboardCheck, page: "ClientReview" },
    ],
  },
   {
    label: "Data & Analytics",
    items: [
      { label: "Investment Analytics", icon: TrendingUp, page: "InvestmentReport" },
      { label: "Reports", icon: BarChart3, page: "Reports" }
    ],
  }
];

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  
  // --- STATE ---
  const [marketData, setMarketData] = useState({ nifty: null, sensex: null, loading: true, error: false });
  const [todayTaskCount, setTodayTaskCount] = useState(0);

  useEffect(() => {
    setUser({
      full_name: "Adi",
      email: "adi@fidelowealth.com",
      role: "Manager"
    });
  }, []);

  // --- SMART READ OPTIMIZATION: Fetch ONLY tasks due exactly today ---
  useEffect(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd"); // This is where it crashed before!
    const qTasks = query(collection(db, "tasks"), where("follow_up_date", "==", todayStr));

    const unsubscribe = onSnapshot(qTasks, (snapshot) => {
      const activeTodayTasks = snapshot.docs
        .map(doc => doc.data())
        .filter(t => !["Completed", "Cancelled"].includes(t.status));
      
      setTodayTaskCount(activeTodayTasks.length);
    }, (error) => {
      console.error("Error fetching today's tasks:", error);
    });

    return () => unsubscribe();
  }, []);

  // --- 0 FIREBASE READS: Fetch from Yahoo Finance ---
  useEffect(() => {
    const fetchMarket = async () => {
      setMarketData(prev => ({ ...prev, loading: true, error: false }));
      try {
        const fetchIndex = async (symbol) => {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
          
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error("Network response was not ok");
          const data = await res.json();
          const meta = data.chart.result[0].meta;
          
          const price = meta.regularMarketPrice;
          const prevClose = meta.previousClose;
          const change = price - prevClose;
          const percent = (change / prevClose) * 100;
          
          return { price, change, percent };
        };

        const [nifty, sensex] = await Promise.all([
          fetchIndex('^NSEI'),
          fetchIndex('^BSESN')
        ]);

        setMarketData({ nifty, sensex, loading: false, error: false });
      } catch (error) {
        console.error("Failed to fetch market data", error);
        setMarketData(prev => ({ ...prev, loading: false, error: true })); 
      }
    };

    fetchMarket();
    const interval = setInterval(fetchMarket, 300000); // 5 mins
    return () => clearInterval(interval);
  }, []);

  const renderMarketPill = (name, data) => {
    if (!data) return null;
    const isUp = data.change >= 0;
    const ColorClass = isUp ? "text-[#4ade80]" : "text-[#f87171]";
    const BgClass = isUp ? "bg-[#4ade80]/10 border-[#4ade80]/20" : "bg-[#f87171]/10 border-[#f87171]/20";
    const Icon = isUp ? TrendingUp : TrendingDown;

    return (
      <div className={`flex items-center gap-3 px-3 py-1.5 rounded-xl border ${BgClass}`}>
        <span className="text-[10px] font-bold text-[#889995] uppercase tracking-wider">{name}</span>
        <span className="text-sm font-black text-white">{data.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
        <div className={`flex items-center gap-1 ${ColorClass}`}>
          <Icon className="w-3 h-3" />
          <span className="text-[10px] font-bold">{Math.abs(data.percent).toFixed(2)}%</span>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "var(--bg-black)", color: "var(--text-main)" }}>
      <style>{`
        :root {
          --brand-green: #008254;
          --brand-dark: #002d20;
          --bg-black: #050a09;
          --text-main: #e0e6e4;
          --text-muted: #889995;
          --glass: rgba(255, 255, 255, 0.03);
          --border: rgba(255, 255, 255, 0.1);
          --input-bg: #0a1612;
          --transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        * { font-family: 'Inter', system-ui, sans-serif; }
        body { 
          background-color: var(--bg-black) !important; 
          color: var(--text-main) !important; 
          margin: 0; 
          overflow: hidden;
        }
        input, select, textarea { background: var(--input-bg) !important; border-color: var(--border) !important; color: var(--text-main) !important; }
        input::placeholder, textarea::placeholder { color: var(--text-muted) !important; }
        input:focus, select:focus, textarea:focus { border-color: var(--brand-green) !important; outline: none !important; }
        
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
      `}</style>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0 lg:static lg:flex lg:h-full flex-shrink-0"
      )} style={{ background: "#040d0a", borderRight: "1px solid var(--border)" }}>
        
        <div className="h-20 px-6 flex items-center flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="FideloWealth" className="w-9 h-9 rounded-xl object-cover" />
            <div>
              <p className="font-semibold text-sm leading-tight" style={{ color: "var(--text-main)" }}>FideloOps</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Client Service Hub</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="mb-6 px-1">
            <a 
              href="https://adi4real.github.io/Fidelo_Main/"
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold transition-all border border-white/5 hover:bg-white/5 hover:border-white/10"
              style={{ color: "var(--text-muted)", letterSpacing: "0.5px" }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              BACK TO PORTAL
            </a>
          </div>

          {navGroups.map(({ label: groupLabel, items }) => (
            <div key={groupLabel || "main"} className="mb-2">
              {groupLabel && (
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.25)", padding: "8px 10px 4px" }}>
                  {groupLabel}
                </p>
              )}
              {items.map(({ label, icon: Icon, page }) => {
                const active = currentPageName === page;
                return (
                  <Link
                    key={page}
                    to={createPageUrl(page)}
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: active ? "var(--brand-green)" : "transparent",
                      color: active ? "white" : "rgba(224,230,228,0.5)",
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User */}
        {user && (
          <div className="px-4 py-4 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,130,84,0.2)" }}>
                <span className="text-xs font-bold" style={{ color: "var(--brand-green)" }}>
                  {user.full_name?.[0] || user.email?.[0] || "U"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--text-main)" }}>{user.full_name || user.email}</p>
                <p className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>{user.role || "user"}</p>
              </div>
              <button onClick={() => db.auth.logout()} style={{ color: "var(--text-muted)" }} className="hover:opacity-80">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* TOP BAR */}
        <header className="h-20 flex-shrink-0 flex items-center px-8 gap-4 sticky top-0 z-30" style={{ background: "#040d0a", borderBottom: "1px solid var(--border)" }}>
          <button
            className="lg:hidden"
            style={{ color: "var(--text-muted)" }}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          
          {/* LIVE MARKET TICKER SECTION */}
          <div className="flex-1 flex items-center justify-start gap-4 overflow-x-auto custom-scrollbar pr-4">
            {marketData.loading ? (
              <div className="text-xs font-bold text-[#889995] animate-pulse flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#4ade80]" /> Fetching Live Markets...
              </div>
            ) : marketData.error ? (
               <div className="text-xs font-bold text-[#f87171] opacity-60 flex items-center gap-2">
                 Market Data Offline
               </div>
            ) : (
              <>
                {renderMarketPill("NIFTY 50", marketData.nifty)}
                {renderMarketPill("SENSEX", marketData.sensex)}
              </>
            )}
          </div>
          
          {/* RIGHT SIDE: BADGE + DATE */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {todayTaskCount > 0 ? (
              <Link 
                to={createPageUrl("LiveTasks")} 
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-colors hover:brightness-110"
                style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", textDecoration: "none" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#fbbf24] animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-wider">{todayTaskCount} Due Today</span>
              </Link>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80" }}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold uppercase tracking-wider">All Clear</span>
              </div>
            )}

            <div className="flex items-center gap-2 border-l border-white/10 pl-4 ml-1">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs font-medium hidden sm:block tracking-wide" style={{ color: "var(--text-muted)" }}>
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
}