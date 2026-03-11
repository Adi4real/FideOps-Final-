const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState } from "react";

import { Upload, Download, X, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

const HEADERS = ["Lead Code", "Lead Name", "RM Assigned", "Branch", "Lead Source", "Lead Category", "Action Stage", "Notes"];
const EXAMPLE = ["LD-26-0001", "Sample Client", "Ujjwal", "Chennai Branch", "Referral", "Normal Lead", "Meeting In-Person", "New prospect"];

const HEADER_MAP = {
  "lead code": "lead_code", "lead_name": "lead_code",
  "lead name": "lead_name", "lead_name": "lead_name",
  "rm assigned": "rm_assigned", "rm_assigned": "rm_assigned",
  "branch": "branch",
  "lead source": "lead_source", "lead_source": "lead_source",
  "lead category": "lead_category", "lead_category": "lead_category",
  "action stage": "action_stage", "action_stage": "action_stage",
  "notes": "notes",
};

function getBranch(rm) {
  if (!rm) return "";
  if (rm === "Ujjwal and Joel") return "Katni Branch";
  if (rm.includes("Ujjwal") || rm.includes("Manny")) return "Chennai Branch";
  if (rm.includes("Uday") || rm.includes("Joel") || rm.includes("Prince")) return "Katni Branch";
  return rm;
}

function downloadTemplate() {
  const rows = [HEADERS.join(","), EXAMPLE.join(",")];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "FideloWealth_Lead_Import_Template.csv"; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const rawHeaders = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, ""));
  const fields = rawHeaders.map(h => HEADER_MAP[h.toLowerCase()] || h.toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
    const obj = {};
    fields.forEach((f, i) => { obj[f] = values[i] || ""; });
    return obj;
  }).filter(r => r.lead_name);
}

const cardStyle = { background: "#0a1612", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 24 };

export default function LeadImport({ onImportDone, onClose }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleUpload = async () => {
    if (!file) return;
    setStatus("loading"); setError("");
    let rows = [];
    if (file.name.toLowerCase().endsWith(".csv")) {
      rows = parseCSV(await file.text());
    } else {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const extracted = await db.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: { type: "object", properties: { leads: { type: "array", items: { type: "object", properties: { lead_code: { type: "string" }, lead_name: { type: "string" }, rm_assigned: { type: "string" }, branch: { type: "string" }, lead_source: { type: "string" }, lead_category: { type: "string" }, action_stage: { type: "string" }, notes: { type: "string" } } } } } }
      });
      if (extracted.status !== "success") { setStatus("error"); setError(extracted.details || "Failed to parse file."); return; }
      rows = Array.isArray(extracted.output) ? extracted.output : (extracted.output?.leads || []);
    }
    if (!rows.length) { setStatus("error"); setError("No valid lead records found."); return; }

    const existing = await db.entities.Lead.list("lead_code", 2000);
    const existingMap = {};
    existing.forEach(l => { existingMap[l.lead_code] = l; });
    let created = 0, updated = 0, failed = 0;

    for (const row of rows) {
      if (!row.lead_name) { failed++; continue; }
      const clean = {
        lead_name: row.lead_name, rm_assigned: row.rm_assigned || "",
        branch: row.branch || getBranch(row.rm_assigned),
        lead_source: row.lead_source || "", lead_category: row.lead_category || "",
        action_stage: row.action_stage || "", notes: row.notes || "", status: "Active",
      };
      if (row.lead_code && existingMap[row.lead_code]) {
        await db.entities.Lead.update(existingMap[row.lead_code].id, clean); updated++;
      } else {
        await db.entities.Lead.create(clean); created++;
      }
    }
    setResult({ created, updated, failed }); setStatus("done"); onImportDone();
  };

  return (
    <div style={cardStyle} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 style={{ color: "#c8d4d0", fontWeight: 600 }}>Import Leads from Excel / CSV</h3>
        <button onClick={onClose} style={{ color: "#889995" }}><X className="w-4 h-4" /></button>
      </div>
      <div style={{ background: "rgba(0,130,84,0.08)", border: "1px solid rgba(0,130,84,0.2)", borderRadius: 12, padding: 16, display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Download className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#008254" }} />
        <div className="flex-1">
          <p style={{ fontSize: 13, fontWeight: 600, color: "#c8d4d0" }}>Step 1: Download the template</p>
          <p style={{ fontSize: 11, color: "#889995", marginTop: 4 }}>{HEADERS.join(" | ")}</p>
        </div>
        <button onClick={downloadTemplate} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "transparent", border: "1px solid #008254", color: "#008254", cursor: "pointer", flexShrink: 0 }}>
          Download
        </button>
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#c8d4d0", marginBottom: 8 }}>Step 2: Upload your file</p>
        <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 100, border: "2px dashed rgba(255,255,255,0.1)", borderRadius: 12, cursor: "pointer" }}>
          <Upload className="w-5 h-5 mb-1" style={{ color: "#889995" }} />
          <span style={{ fontSize: 13, color: "#889995" }}>{file ? file.name : "Click to select .xlsx or .csv"}</span>
          <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0])} />
        </label>
      </div>
      {error && <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, padding: "10px 14px", color: "#f87171", fontSize: 13, display: "flex", gap: 8 }}><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
      {status === "done" && result && (
        <div style={{ background: "rgba(0,130,84,0.1)", border: "1px solid rgba(0,130,84,0.2)", borderRadius: 10, padding: "10px 14px", color: "#4ade80", fontSize: 13, display: "flex", gap: 8 }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          Import complete! {result.created} created · {result.updated} updated · {result.failed} skipped
        </div>
      )}
      {status !== "done" && (
        <div className="flex justify-end">
          <button onClick={handleUpload} disabled={!file || status === "loading"} style={{ padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: !file || status === "loading" ? "rgba(0,130,84,0.3)" : "#008254", color: "white", border: "none", cursor: !file ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            {status === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</> : "Import Leads"}
          </button>
        </div>
      )}
    </div>
  );
}