import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const RM_OPTIONS = ["Ujjwal", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel", "Uday", "Joel", "Manny", "Prince"];

// Updated Categories
const LEAD_CATEGORIES = ["Normal Lead", "Strong Lead"];

// Updated Action Stages (Moved 3 from categories, removed Documentation Complete)
const ACTION_STAGES = [
  "Meet Urgent", "Upcoming Meeting","Meeting In-Person", "Financial Planning", "Zoom Call", "Meeting minutes", "KYC Pending",
  "KYC Check", "KYC Modify", "NSE Form", "eNACH Mandate",
  "Physical Mandate", "Physical KYC", "Onboarding Completed"
];

function getBranch(rm) {
  if (!rm) return "";
  if (rm === "Ujjwal and Joel") return "Katni Branch";
  if (rm.includes("Ujjwal") || rm.includes("Manny")) return "Chennai Branch";
  if (rm.includes("Uday") || rm.includes("Joel") || rm.includes("Prince")) return "Katni Branch";
  return "";
}

const inputStyle = {
  width: "100%", padding: "10px 14px",
  background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px", color: "#c8d4d0", fontSize: "13px",
};

export default function LeadForm({ lead, onSave, onClose }) {
  const [form, setForm] = useState(lead || {
    lead_name: "", rm_assigned: "", branch: "", lead_source: "",
    lead_category: "", action_stage: "", notes: "",
  });

  const set = (k, v) => {
    if (k === "rm_assigned") {
      setForm(f => ({ ...f, rm_assigned: v, branch: getBranch(v) }));
    } else {
      setForm(f => ({ ...f, [k]: v }));
    }
  };

  return (
    <div className="rounded-2xl p-6 space-y-4" style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: "#c8d4d0" }}>{lead ? "Edit Lead" : "Add New Lead"}</h3>
        <button onClick={onClose} style={{ color: "#889995" }}><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>Lead Name *</label>
          <input style={inputStyle} value={form.lead_name || ""} onChange={e => set("lead_name", e.target.value)} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>RM Assigned</label>
          <select style={inputStyle} value={form.rm_assigned || ""} onChange={e => set("rm_assigned", e.target.value)}>
            <option value="">Select RM</option>
            {RM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>Branch (Auto-populated)</label>
          <input style={{ ...inputStyle, opacity: 0.6 }} value={form.branch || ""} readOnly />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>Lead Source</label>
          <input style={inputStyle} value={form.lead_source || ""} onChange={e => set("lead_source", e.target.value)} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>Lead Category</label>
          <select style={inputStyle} value={form.lead_category || ""} onChange={e => set("lead_category", e.target.value)}>
            <option value="">Select Category</option>
            {LEAD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>Action Stage</label>
          <select style={inputStyle} value={form.action_stage || ""} onChange={e => set("action_stage", e.target.value)}>
            <option value="">Select Stage</option>
            {ACTION_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 }}>Notes</label>
          <textarea rows={2} style={inputStyle} value={form.notes || ""} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#889995", cursor: "pointer" }}>Cancel</button>
        <button onClick={() => onSave(form)} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "#008254", color: "white", border: "none", cursor: "pointer" }}>
          {lead ? "Save Changes" : "Add Lead"}
        </button>
      </div>
    </div>
  );
}