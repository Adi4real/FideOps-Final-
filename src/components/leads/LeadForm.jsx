import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";

const RM_OPTIONS = ["Ujjwal", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel", "Uday", "Joel", "Manny", "Prince"];
const LEAD_CATEGORIES = ["Normal Lead", "Strong Lead"];
const ACTION_STAGES = [
  "Meet Urgent", "Upcoming Meeting","Meeting In-Person", "Financial Planning", "Zoom Call", "Meeting minutes","Term", "Health", "KYC Pending",
  "KYC Check", "NSE Platform", "Mandate", "Transaction", "App & Broadcast", "Onboarding Completed"
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

const labelStyle = { display: "block", fontSize: "10px", fontWeight: 700, color: "#889995", textTransform: "uppercase", marginBottom: 6 };

export default function LeadForm({ lead, onSave, onClose }) {
  const [form, setForm] = useState(lead || {
    lead_name: "", rm_assigned: "", branch: "", lead_source: "",
    lead_category: "", action_stage: "", notes: "",
    investments: [{ product_name: "", amount: "" }] // Initialize with one row
  });

  const set = (k, v) => {
    if (k === "rm_assigned") {
      setForm(f => ({ ...f, rm_assigned: v, branch: getBranch(v) }));
    } else {
      setForm(f => ({ ...f, [k]: v }));
    }
  };

  // Investment Logic
  const addInvestment = () => {
    setForm(f => ({
      ...f,
      investments: [...(f.investments || []), { product_name: "", amount: "" }]
    }));
  };

  const updateInvestment = (index, field, value) => {
    const updated = [...form.investments];
    updated[index][field] = value;
    setForm(f => ({ ...f, investments: updated }));
  };

  const removeInvestment = (index) => {
    const updated = form.investments.filter((_, i) => i !== index);
    setForm(f => ({ ...f, investments: updated }));
  };

  return (
    <div className="rounded-2xl p-6 space-y-4" style={{ background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: "#c8d4d0" }}>{lead ? "Edit Lead" : "Add New Lead"}</h3>
        <button onClick={onClose} style={{ color: "#889995" }}><X className="w-4 h-4" /></button>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Lead Name *</label>
          <input style={inputStyle} value={form.lead_name || ""} onChange={e => set("lead_name", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>RM Assigned</label>
          <select style={inputStyle} value={form.rm_assigned || ""} onChange={e => set("rm_assigned", e.target.value)}>
            <option value="">Select RM</option>
            {RM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Branch (Auto-populated)</label>
          <input style={{ ...inputStyle, opacity: 0.6 }} value={form.branch || ""} readOnly />
        </div>
        <div>
          <label style={labelStyle}>Lead Source</label>
          <input style={inputStyle} value={form.lead_source || ""} onChange={e => set("lead_source", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Lead Category</label>
          <select style={inputStyle} value={form.lead_category || ""} onChange={e => set("lead_category", e.target.value)}>
            <option value="">Select Category</option>
            {LEAD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Action Stage</label>
          <select style={inputStyle} value={form.action_stage || ""} onChange={e => set("action_stage", e.target.value)}>
            <option value="">Select Stage</option>
            {ACTION_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Conditional Transaction Inputs */}
        {form.action_stage === "Transaction" && (
          <div className="sm:col-span-2 space-y-3 p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center justify-between">
              <p style={{ ...labelStyle, marginBottom: 0 }}>Investment Details</p>
              <button 
                type="button" 
                onClick={addInvestment}
                style={{ background: "#008254", color: "white", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px", border: "none", cursor: "pointer" }}
              >
                <Plus className="w-3 h-3" /> Add Product
              </button>
            </div>
            
            {form.investments?.map((inv, index) => (
              <div key={index} className="flex gap-3 items-end">
                <div className="flex-1">
                  {index === 0 && <label style={{ fontSize: "9px", color: "#556660", marginBottom: "4px", display: "block" }}>Product Name</label>}
                  <input 
                    style={inputStyle} 
                    placeholder="e.g. HDFC Bluechip" 
                    value={inv.product_name} 
                    onChange={(e) => updateInvestment(index, "product_name", e.target.value)} 
                  />
                </div>
                <div style={{ width: "120px" }}>
                  {index === 0 && <label style={{ fontSize: "9px", color: "#556660", marginBottom: "4px", display: "block" }}>Amount (₹)</label>}
                  <input 
                    style={inputStyle} 
                    type="number" 
                    placeholder="5000" 
                    value={inv.amount} 
                    onChange={(e) => updateInvestment(index, "amount", e.target.value)} 
                  />
                </div>
                {form.investments.length > 1 && (
                  <button 
                    onClick={() => removeInvestment(index)}
                    style={{ background: "transparent", border: "none", color: "#f87171", padding: "8px", cursor: "pointer" }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="sm:col-span-2">
          <label style={labelStyle}>Notes</label>
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