import { db, auth } from "./firebase";
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";

import {
  LayoutDashboard, Plus, Users, ListChecks, BarChart3, Calendar,
  Menu, X, LogOut, ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: null,
    items: [{ label: "Dashboard", icon: LayoutDashboard, page: "Dashboard" }],
  },
  {
    label: "Business Development",
    items: [{ label: "Lead Clients", icon: Users, page: "LeadClients" }],
  },
  {
    label: "Task Manager",
    items: [
      { label: "New Task", icon: Plus, page: "NewTask" },
      { label: "Live Tasks", icon: ListChecks, page: "LiveTasks" },
    ],
  },
  {
    label: "Records",
    items: [
      { label: "Clients", icon: Users, page: "Clients" },
      { label: "Reports", icon: BarChart3, page: "Reports" },
      { label: "Calendar", icon: Calendar, page: "CalendarView" },
    ],
  },
];

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    setUser({
      full_name: "Adi",
      email: "adi@fidelowealth.com",
      role: "Manager"
    });
  }, []);

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg-black)", color: "var(--text-main)" }}>
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
        body { background-color: var(--bg-black) !important; color: var(--text-main) !important; }
        input, select, textarea { background: var(--input-bg) !important; border-color: var(--border) !important; color: var(--text-main) !important; }
        input::placeholder, textarea::placeholder { color: var(--text-muted) !important; }
        input:focus, select:focus, textarea:focus { border-color: var(--brand-green) !important; outline: none !important; }
      `}</style>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0 lg:static lg:flex"
      )} style={{ background: "#040d0a", borderRight: "1px solid var(--border)" }}>
        
        {/* Logo */}
        <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <img
              src="logo.png"
              alt="FideloWealth"
              className="w-9 h-9 rounded-xl object-cover"
            />
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>FideloOps</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Client Service Hub</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          
          {/* Go Back Button */}
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
          <div className="px-4 py-4" style={{ borderTop: "1px solid var(--border)" }}>
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

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 flex items-center px-4 gap-4 sticky top-0 z-30" style={{ background: "#040d0a", borderBottom: "1px solid var(--border)" }}>
          <button
            className="lg:hidden"
            style={{ color: "var(--text-muted)" }}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs hidden sm:block" style={{ color: "var(--text-muted)" }}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}