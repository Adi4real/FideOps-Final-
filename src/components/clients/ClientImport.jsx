const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState } from "react";

import { Upload, Download, X, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const TEMPLATE_HEADERS = ["Client Code", "Client Name", "RM Assigned", "Branch", "Notes"];
const TEMPLATE_EXAMPLE = ["FW-C001", "Rajesh Mehta", "Priya Sharma", "Mumbai", "HNI client"];

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE.join(",")];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "FideloWealth_Client_Import_Template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Header name → field name mapping
const HEADER_MAP = {
  "client code": "client_code",
  "client_code": "client_code",
  "client name": "client_name",
  "client_name": "client_name",
  "rm assigned": "rm_assigned",
  "rm_assigned": "rm_assigned",
  "branch": "branch",
  "notes": "notes",
};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, ""));
  const fields = rawHeaders.map(h => HEADER_MAP[h.toLowerCase()] || h.toLowerCase().replace(/\s+/g, "_"));

  return lines.slice(1)
    .map(line => {
      const values = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
      const obj = {};
      fields.forEach((f, i) => { obj[f] = values[i] || ""; });
      return obj;
    })
    .filter(row => row.client_code || row.client_name);
}

async function extractFromExcel(file) {
  const { file_url } = await db.integrations.Core.UploadFile({ file });
  const extracted = await db.integrations.Core.ExtractDataFromUploadedFile({
    file_url,
    json_schema: {
      type: "object",
      properties: {
        clients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              client_code: { type: "string" },
              client_name: { type: "string" },
              rm_assigned: { type: "string" },
              branch: { type: "string" },
              notes: { type: "string" },
            }
          }
        }
      }
    }
  });

  if (extracted.status !== "success") throw new Error(extracted.details || "Failed to extract data.");
  return Array.isArray(extracted.output) ? extracted.output : (extracted.output?.clients || []);
}

export default function ClientImport({ onImportDone, onClose }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleUpload = async () => {
    if (!file) return;
    setStatus("loading");
    setError("");

    let rows = [];
    const isCSV = file.name.toLowerCase().endsWith(".csv");

    if (isCSV) {
      const text = await file.text();
      rows = parseCSV(text);
    } else {
      rows = await extractFromExcel(file);
    }

    if (!rows.length) {
      setStatus("error");
      setError("No valid client records found. Make sure the file uses the correct template headers.");
      return;
    }

    let created = 0, updated = 0, failed = 0;
    const existing = await db.entities.Client.list("client_code", 2000);
    const existingMap = {};
    existing.forEach(c => { existingMap[c.client_code] = c; });

    for (const row of rows) {
      if (!row.client_code || !row.client_name) { failed++; continue; }
      const clean = {
        client_code: String(row.client_code).trim(),
        client_name: String(row.client_name).trim(),
        rm_assigned: row.rm_assigned || "",
        branch: row.branch || "",
        notes: row.notes || "",
      };
      if (existingMap[clean.client_code]) {
        await db.entities.Client.update(existingMap[clean.client_code].id, clean);
        updated++;
      } else {
        await db.entities.Client.create(clean);
        created++;
      }
    }

    setResult({ created, updated, failed, total: rows.length });
    setStatus("done");
    onImportDone();
  };

  return (
    <div className="bg-black rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-black-500">Import Clients from Excel / CSV</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="bg-black flex items-start gap-3 p-4 bg-green-50 rounded-xl border border-green-100">
        <Download className="w-4 h-4 text-[#00765B] mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-white-700">Step 1: Download the template</p>
          <p className="text-xs text-white-500 mt-0.5">
            Required columns: <span className="font-mono text-xs text-[#00765B]">{TEMPLATE_HEADERS.join(" | ")}</span>
          </p>
          <p className="text-xs text-white-400 mt-1">Client Code and Client Name are required. Existing records with matching Client Code will be updated.</p>
        </div>
        <Button variant="outline" size="sm" onClick={downloadTemplate} className="bg-black border-[#00765B] text-[#00765B] hover:bg-green-50 flex-shrink-0">
          Download Template
        </Button>
      </div>

      <div>
        <p className="text-sm font-medium text-white-700 mb-2">Step 2: Upload your file (.csv or .xlsx)</p>
        <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-white-200 rounded-xl cursor-pointer hover:border-[#00765B] hover:bg-green-50/30 transition-colors">
          <Upload className="w-6 h-6 text-white-300 mb-1" />
          <span className="text-sm text-white-400">{file ? file.name : "Click to select .xlsx or .csv file"}</span>
          <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0])} />
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl text-sm text-red-600 border border-red-100">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {status === "done" && result && (
        <div className="flex items-start gap-3 p-4 bg-green-50 rounded-xl border border-green-100">
          <CheckCircle2 className="w-5 h-5 text-[#00765B] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700">
            <p className="font-semibold">Import complete!</p>
            <p className="mt-1 text-xs text-gray-500">
              {result.created} created · {result.updated} updated · {result.failed} skipped
            </p>
          </div>
        </div>
      )}

      {status !== "done" && (
        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={!file || status === "loading"}
            className="bg-[#00765B] hover:bg-[#005c46] text-white rounded-xl"
          >
            {status === "loading" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</> : "Import Clients"}
          </Button>
        </div>
      )}
    </div>
  );
}