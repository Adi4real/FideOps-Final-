import { useState } from "react";
import { Upload, Download, X, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";

import { db } from "../../firebase"; 
import { collection, getDocs, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const TEMPLATE_HEADERS = [
  "Client Code", "Client Name", "xSIP Registration Number", "Holding Nature", "Scheme Name", 
  "Frequency Type", "Start Date", "End Date", "Installment Amount", "Folio Number", 
  "RM Assigned", "Branch", "Notes"
];

const TEMPLATE_EXAMPLE = [
  "PAN1234567", "Rajesh Mehta", "XSIP-998877", "Single", "HDFC Bluechip", 
  "Monthly", "2024-01-01", "2034-01-01", "5000", "FOLIO98765", 
  "Priya Sharma", "Mumbai", "HNI client"
];

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

const HEADER_MAP = {
  "client code": "client_code",
  "client name": "client_name",
  "xsip registration number": "xsip_reg_no",
  "holding nature": "holding_nature",
  "scheme name": "scheme_name",
  "frequency type": "frequency_type",
  "start date": "start_date",
  "end date": "end_date",
  "installment amount": "installment_amount",
  "folio number": "folio_number",
  "rm assigned": "rm_assigned",
  "branch": "branch",
  "notes": "notes",
};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  return lines.slice(1)
    .map(line => {
      const values = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
      const obj = {};
      rawHeaders.forEach((header, i) => {
        const mappedKey = HEADER_MAP[header];
        if (mappedKey) obj[mappedKey] = values[i] || ""; 
      });
      return obj;
    })
    .filter(row => row.client_code && row.client_name);
}

async function parseExcel(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  return json.map(row => {
    const obj = {};
    Object.keys(row).forEach(key => {
      const cleanHeader = key.trim().toLowerCase();
      const mappedKey = HEADER_MAP[cleanHeader];
      if (mappedKey) {
        obj[mappedKey] = String(row[key]).trim();
      }
    });
    return obj;
  }).filter(row => row.client_code && row.client_name);
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

    const isCSV = file.name.toLowerCase().endsWith(".csv");
    const isExcel = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");

    if (!isCSV && !isExcel) {
      setStatus("error");
      setError("Please upload a .csv or .xlsx file.");
      return;
    }

    try {
      let rawRows = [];
      if (isCSV) {
        const text = await file.text();
        rawRows = parseCSV(text);
      } else if (isExcel) {
        rawRows = await parseExcel(file);
      }

      if (!rawRows.length) {
        setStatus("error");
        setError("No valid client records found. Check headers.");
        return;
      }

      // --- STEP 1: Group rows by Client Code ---
      const groupedClients = {};
      
      rawRows.forEach(row => {
        const code = row.client_code ? String(row.client_code).trim() : "-";
        if (code === "-") return;

        if (!groupedClients[code]) {
          groupedClients[code] = {
            client_code: code,
            client_name: row.client_name ? String(row.client_name).trim() : "-",
            rm_assigned: row.rm_assigned ? String(row.rm_assigned).trim() : "-",
            branch: row.branch ? String(row.branch).trim() : "-",
            notes: row.notes ? String(row.notes).trim() : "-",
            investments: [] // Initialize empty array for investments
          };
        }

        // Generate a random fallback ID if xSIP is missing so it doesn't overwrite other missing ones
        const xsip = row.xsip_reg_no ? String(row.xsip_reg_no).trim() : `UNKNOWN-${Math.floor(Math.random()*10000)}`;

        groupedClients[code].investments.push({
          xsip_reg_no: xsip,
          holding_nature: row.holding_nature ? String(row.holding_nature).trim() : "-",
          scheme_name: row.scheme_name ? String(row.scheme_name).trim() : "-",
          frequency_type: row.frequency_type ? String(row.frequency_type).trim() : "-",
          start_date: row.start_date ? String(row.start_date).trim() : "-",
          end_date: row.end_date ? String(row.end_date).trim() : "-",
          installment_amount: row.installment_amount ? String(row.installment_amount).trim() : "-",
          folio_number: row.folio_number ? String(row.folio_number).trim() : "-"
        });
      });

      // --- STEP 2: Fetch Existing Database ---
      const clientsRef = collection(db, "clients");
      const snapshot = await getDocs(clientsRef);
      
      const existingMap = {};
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.client_code) {
          existingMap[data.client_code] = { id: docSnap.id, data };
        }
      });

      let created = 0, updated = 0;

      // --- STEP 3: Merge and Save ---
      for (const code of Object.keys(groupedClients)) {
        const newClientData = groupedClients[code];
        const existingRecord = existingMap[code];

        if (existingRecord) {
          // Merge investments
          let mergedInvestments = [...(existingRecord.data.investments || [])];
          
          newClientData.investments.forEach(newInv => {
            const matchIndex = mergedInvestments.findIndex(i => !i.xsip_reg_no.startsWith("UNKNOWN") && i.xsip_reg_no === newInv.xsip_reg_no);
            if (matchIndex >= 0) {
              mergedInvestments[matchIndex] = newInv; // Update existing
            } else {
              mergedInvestments.push(newInv); // Add new
            }
          });

          const docRef = doc(db, "clients", existingRecord.id);
          await updateDoc(docRef, { 
            ...newClientData, 
            investments: mergedInvestments,
            updated_at: serverTimestamp() 
          });
          updated++;
        } else {
          // Create new client with investments array
          await addDoc(collection(db, "clients"), { 
            ...newClientData, 
            created_at: serverTimestamp() 
          });
          created++;
        }
      }

      setResult({ created, updated, failed: 0, total: rawRows.length });
      setStatus("done");
      
      setTimeout(() => {
        onImportDone();
      }, 2500);

    } catch (err) {
      console.error("Import Error:", err);
      setStatus("error");
      setError(err.message || "An error occurred during import.");
    }
  };

  return (
    <div className="bg-[#0a1612] rounded-2xl shadow-sm border border-[rgba(255,255,255,0.1)] p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#c8d4d0]">Import Clients from Excel / CSV</h3>
        <button onClick={onClose} className="text-[#889995] hover:text-white transition-colors"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl border border-[rgba(0,130,84,0.3)] bg-[rgba(0,130,84,0.05)]">
        <Download className="w-4 h-4 text-brand-green mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-[#c8d4d0]">Step 1: Download the template</p>
          <p className="text-xs text-[#889995] mt-0.5">
            Includes new fields: <span className="font-mono text-[10px] text-brand-green">xSIP Registration Number, Holding Nature</span>
          </p>
          <p className="text-[10px] text-[#889995] mt-1">If xSIP Number is identical, it updates the existing investment. If missing, a new sub-investment is created.</p>
        </div>
        <button onClick={downloadTemplate} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-green text-brand-green hover:bg-brand-green hover:text-white transition-all flex-shrink-0">
          Download Template
        </button>
      </div>

      <div>
        <p className="text-sm font-medium text-[#c8d4d0] mb-2">Step 2: Upload your file (.csv or .xlsx)</p>
        <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-[rgba(255,255,255,0.1)] rounded-xl cursor-pointer hover:border-brand-green hover:bg-[rgba(0,130,84,0.02)] transition-colors">
          <Upload className="w-6 h-6 text-[#889995] mb-1" />
          <span className="text-sm text-[#889995]">{file ? file.name : "Click to select .xlsx or .csv file"}</span>
          <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0])} />
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[rgba(248,113,113,0.1)] rounded-xl text-sm text-[#f87171] border border-[rgba(248,113,113,0.2)]">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {status === "done" && result && (
        <div className="flex items-start gap-3 p-4 bg-[rgba(0,130,84,0.1)] rounded-xl border border-[rgba(0,130,84,0.3)]">
          <CheckCircle2 className="w-5 h-5 text-[#4ade80] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[#c8d4d0]">
            <p className="font-semibold text-white">Import complete!</p>
            <p className="mt-1 text-xs text-[#889995]">
              {result.created} clients created · {result.updated} updated
            </p>
          </div>
        </div>
      )}

      {status !== "done" && (
        <div className="flex justify-end">
          <button
            onClick={handleUpload}
            disabled={!file || status === "loading"}
            className="px-5 py-2.5 rounded-xl font-bold text-sm bg-[#008254] text-white disabled:opacity-50 flex items-center justify-center transition-opacity"
          >
            {status === "loading" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</> : "Import Clients"}
          </button>
        </div>
      )}
    </div>
  );
}