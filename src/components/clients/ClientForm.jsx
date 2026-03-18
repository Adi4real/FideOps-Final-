import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const HOLDING_NATURES = ["SINGLE", "JOINT", "ANYONE OR SURVIVOR"];

const TAX_STATUSES = [
  "INDIVIDUAL", "NRI - NRO [NON REPATRIATION]", "NRI - REPATRIABLE (NRE)", "OCI - REPATRIATION", 
  "OCI - NON REPATRIATION", "PERSON OF INDIAN ORIGIN", "SEAFARER NRE", "SEAFARER NRO", 
  "PERSON OF INDIAN ORIGIN [PIO] - NRO", "ON BEHALF OF MINOR", "HUF", "COMPANY", "AOP", 
  "PARTNERSHIP FIRM", "BODY CORPORATE", "TRUST", "SOCIETY", "OTHERS", "NRI-OTHERS", "DFI", 
  "SOLE PROPRIETORSHIP", "OCB", "FII", "OVERSEAS CORP. BODY - OTHERS", "NRI CHILD", 
  "NRI - HUF (NRO)", "NRI - MINOR (NRO)", "NRI - HUF (NRE)", "PROVIDENT FUND", 
  "SUPER ANNUATION FUND", "GRATUITY FUND", "PENSION FUND", "MUTUAL FUNDS FOF SCHEMES", 
  "NPS TRUST", "GLOBAL DEVELOPMENT NETWORK", "FCRA", "QFI - INDIVIDUAL", "QFI - MINORS", 
  "QFI - CORPORATE", "QFI - PENSION FUNDS", "QFI - HEDGE FUNDS", "QFI - MUTUAL FUNDS", "LLP", 
  "NON- PROFIT ORGANIZATION (NPO)", "PUBLIC LIMITED COMPANY", "PRIVATE LIMITED COMPANY", 
  "UNLISTED COMPANY", "MUTUAL FUNDS", "FPI - CATEGORY I", "FPI - CATEGORY II", 
  "FPI - CATEGORY III", "FINANCIAL INSTITUTION", "BODY OF INDIVIDUALS", "INSURANCE COMPANY", 
  "GOVERNMENT BODY", "DEFENSE ESTABLISHMENT", "NON - GOVERNMENT ORGANISATION", 
  "BANK/CO-OPERATIVE BANK", "ARTIFICIAL JURIDICAL PERSON", "LOCAL AUTHORITY"
];

const RM_LIST = [
  "Ujjwal", "Ujjwal and Manny", "Ujjwal and Joel", "Uday and Joel", 
  "Uday", "Joel", "Manny", "Prince"
];

// --- HELPER: Auto-map RM to Branch ---
function getBranch(rm) {
  if (!rm) return "";
  if (rm === "Ujjwal and Joel") return "Katni";
  if (rm.includes("Ujjwal") || rm.includes("Manny")) return "Chennai";
  if (rm.includes("Uday") || rm.includes("Joel") || rm.includes("Prince")) return "Katni";
  return rm;
}

export default function ClientForm({ client, onSave, onClose }) {
  const [form, setForm] = useState(client || {
    client_code: "", client_name: "", holding_nature: "", tax_status: "", 
    rm_assigned: "", branch: "", notes: "", investments: []
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addInvestment = () => {
    setForm(f => ({
      ...f, investments: [...(f.investments || []), { 
        folio_number: "", xsip_reg_no: "", scheme_name: "", 
        installment_amount: "", frequency_type: "", start_date: "", end_date: "" 
      }]
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
    <div className="bg-black rounded-2xl shadow-sm border border-white/10 p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-white">{client ? "Edit Client" : "Add New Client"}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">Client Code *</Label>
          <Input value={form.client_code || ""} onChange={e => set("client_code", e.target.value)} required readOnly={!!client} className={client ? "bg-white/5 border-white/10 text-white/50" : "bg-black border-white/10 text-white"} />
        </div>
        <div>
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">Client Name *</Label>
          <Input value={form.client_name || ""} onChange={e => set("client_name", e.target.value)} required className="bg-black border-white/10 text-white" />
        </div>

        <div>
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">Holding Nature</Label>
          <select 
            value={form.holding_nature || ""} 
            onChange={e => set("holding_nature", e.target.value)} 
            className="flex h-10 w-full rounded-md border border-white/10 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#008254]"
          >
            <option value="">Select Holding Nature</option>
            {HOLDING_NATURES.map(hn => <option key={hn} value={hn}>{hn}</option>)}
          </select>
        </div>

        <div>
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">Tax Status</Label>
          <select 
            value={form.tax_status || ""} 
            onChange={e => set("tax_status", e.target.value)} 
            className="flex h-10 w-full rounded-md border border-white/10 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#008254]"
          >
            <option value="">Select Tax Status</option>
            {TAX_STATUSES.map(ts => <option key={ts} value={ts}>{ts}</option>)}
          </select>
        </div>

        {/* Updated RM Assigned Dropdown with Auto-Mapping */}
        <div>
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">RM Assigned</Label>
          <select 
            value={form.rm_assigned || ""} 
            onChange={e => {
              const selectedRM = e.target.value;
              setForm(f => ({ 
                ...f, 
                rm_assigned: selectedRM,
                branch: getBranch(selectedRM) // <-- Auto updates the branch!
              }));
            }} 
            className="flex h-10 w-full rounded-md border border-white/10 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#008254]"
          >
            <option value="">Select RM...</option>
            {RM_LIST.map(rm => <option key={rm} value={rm}>{rm}</option>)}
          </select>
        </div>
        
        <div>
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">Branch</Label>
          <Input value={form.branch || ""} onChange={e => set("branch", e.target.value)} className="bg-black border-white/10 text-white" />
        </div>
        
        <div className="sm:col-span-2">
          <Label className="text-xs text-white/50 mb-1 block uppercase tracking-wider">Notes</Label>
          <Textarea rows={2} value={form.notes || ""} onChange={e => set("notes", e.target.value)} className="bg-black border-white/10 text-white" />
        </div>
      </div>

      {/* Manual Investments Entry */}
      <div className="mt-8 border-t border-white/10 pt-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">Investments</h4>
          <Button type="button" onClick={addInvestment} size="sm" className="bg-[#008254] hover:bg-[#006843] text-white h-7 text-xs px-3 py-0 rounded-lg">
            <Plus className="w-3 h-3 mr-1" /> Add Folio/xSIP
          </Button>
        </div>

        <div className="space-y-4">
          {form.investments?.map((inv, index) => (
            <div key={index} className="p-4 rounded-xl border border-white/10 bg-white/5 relative">
              <button type="button" onClick={() => removeInvestment(index)} className="absolute top-2 right-2 p-1.5 bg-red-500/10 text-red-500 rounded-md hover:bg-red-500/20">
                <Trash2 className="w-3 h-3" />
              </button>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-[10px] text-white/50 mb-1 block">Folio Number</Label>
                  <Input value={inv.folio_number} onChange={e => updateInvestment(index, "folio_number", e.target.value)} className="h-8 text-xs bg-black border-white/10 text-white" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-[10px] text-white/50 mb-1 block">xSIP Reg No.</Label>
                  <Input value={inv.xsip_reg_no} onChange={e => updateInvestment(index, "xsip_reg_no", e.target.value)} className="h-8 text-xs bg-black border-white/10 text-white" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-[10px] text-white/50 mb-1 block">Scheme Name</Label>
                  <Input value={inv.scheme_name} onChange={e => updateInvestment(index, "scheme_name", e.target.value)} className="h-8 text-xs bg-black border-white/10 text-white" />
                </div>
                <div>
                  <Label className="text-[10px] text-white/50 mb-1 block">Amount (₹)</Label>
                  <Input value={inv.installment_amount} onChange={e => updateInvestment(index, "installment_amount", e.target.value)} className="h-8 text-xs bg-black border-white/10 text-white" />
                </div>
                <div>
                  <Label className="text-[10px] text-white/50 mb-1 block">Frequency</Label>
                  <Input value={inv.frequency_type} onChange={e => updateInvestment(index, "frequency_type", e.target.value)} className="h-8 text-xs bg-black border-white/10 text-white" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-white/50 mb-1 block">Start Date</Label>
                    <Input type="date" value={inv.start_date} onChange={e => updateInvestment(index, "start_date", e.target.value)} className="h-8 text-[10px] bg-black border-white/10 text-white" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-white/50 mb-1 block">End Date</Label>
                    <Input type="date" value={inv.end_date} onChange={e => updateInvestment(index, "end_date", e.target.value)} className="h-8 text-[10px] bg-black border-white/10 text-white" />
                  </div>
                </div>
              </div>
            </div>
          ))}
          {form.investments?.length === 0 && (
            <p className="text-xs text-white/30 italic text-center py-4">No investments added manually.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-white/5">
        <Button variant="outline" onClick={onClose} className="bg-white text-black hover:bg-gray-200 border-none rounded-xl font-bold px-6">Cancel</Button>
        <Button onClick={() => onSave(form)} className="bg-[#00765B] hover:bg-[#005c46] text-white rounded-xl font-bold px-6 shadow-lg shadow-brand-green/20">
          {client ? "Save Changes" : "Add Client"}
        </Button>
      </div>
    </div>
  );
}