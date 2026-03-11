import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function ClientForm({ client, onSave, onClose }) {
  const [form, setForm] = useState(client || {
    client_code: "",
    client_name: "",
    rm_assigned: "",
    branch: "",
    notes: "",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="bg-black rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white-800">{client ? "Edit Client" : "Add New Client"}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-white-500 mb-1 block">Client Code *</Label>
          <Input
            value={form.client_code || ""}
            onChange={e => set("client_code", e.target.value)}
            required
            readOnly={!!client}
            className={client ? "bg-gray-50 text-white-500" : ""}
          />
        </div>
        <div>
          <Label className="text-xs text-white-500 mb-1 block">Client Name *</Label>
          <Input value={form.client_name || ""} onChange={e => set("client_name", e.target.value)} required />
        </div>
        <div>
          <Label className="text-xs text-white-500 mb-1 block">RM Assigned</Label>
          <Input value={form.rm_assigned || ""} onChange={e => set("rm_assigned", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-white-500 mb-1 block">Branch</Label>
          <Input value={form.branch || ""} onChange={e => set("branch", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-white-500 mb-1 block">Notes</Label>
          <Textarea rows={2} value={form.notes || ""} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
<div className="flex justify-end gap-3 mt-8 pt-4 border-t border-white/5">
  <Button 
    variant="outline" 
    onClick={onClose} 
    className="bg-white text-black hover:bg-gray-200 border-none rounded-xl font-bold px-6"
  >
    Cancel
  </Button>
  <Button 
    onClick={() => onSave(form)} 
    className="bg-[#00765B] hover:bg-[#005c46] text-white rounded-xl font-bold px-6 shadow-lg shadow-brand-green/20"
  >
    {client ? "Save Changes" : "Add Client"}
  </Button>
</div>
    </div>
  );
}