import { useState } from "react";
import { Upload, Download, X, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";

import { db } from "../../firebase"; 
import { collection, getDocs, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const TEMPLATE_HEADERS = [
  "Client Code", "Client Name", "Tax Status", "Holding Nature", 
  "Folio Number", "xSIP Registration Number", "Scheme Name", 
  "Frequency Type", "Start Date", "End Date", "Installment Amount", 
  "RM Assigned", "Branch", "Notes"
];

const TEMPLATE_EXAMPLE = [
  "PAN1234567", "Rajesh Mehta", "INDIVIDUAL", "SINGLE", 
  "FOLIO98765", "99887766", "HDFC Bluechip", 
  "Monthly", "2024-01-01", "2034-01-01", "5000", 
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
  "tax status": "tax_status",
  "holding nature": "holding_nature",
  "xsip registration number": "xsip_reg_no",
  "xsip reg no": "xsip_reg_no",
  "scheme name": "scheme_name",
  "frequency type": "frequency_type",
  "start date": "start_date",
  "end date": "end_date",
  "installment amount": "installment_amount",
  "installments amount": "installment_amount", // Added plural fallback
  "amount": "installment_amount", // Added generic fallback
  "folio number": "folio_number",
  "rm assigned": "rm_assigned",
  "branch": "branch",
  "notes": "notes",
};

// Helper: Safely extracts numbers from an xSIP string to ensure strict matching
function parseXSIPAsNumber(val) {
  if (!val || val === "-" || String(val).trim() === "") return null;
  // Extract only the digits from the text (e.g. "XSIP-12345" becomes "12345")
  const numericPart = String(val).replace(/\D/g, '');
  return numericPart.length > 0 ? numericPart : String(val).trim();
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
    const obj = {};
    rawHeaders.forEach((header, i) => {
      const mappedKey = HEADER_MAP[header];
      if (mappedKey) obj[mappedKey] = values[i] || ""; 
    });
    return obj;
  }).filter(row => row.client_code && row.client_name);
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
      if (mappedKey) obj[mappedKey] = String(row[key]).trim();
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
      setStatus("error"); setError("Please upload a .csv or .xlsx file."); return;
    }

    try {
      let rawRows = isCSV ? parseCSV(await file.text()) : await parseExcel(file);
      if (!rawRows.length) {
        setStatus("error"); setError("No valid client records found. Check headers."); return;
      }

      // 1. Fetch current DB state into memory
      const clientsRef = collection(db, "clients");
      const snapshot = await getDocs(clientsRef);
      const inMemoryDB = snapshot.docs.map(d => ({ id: d.id, isNew: false, isModified: false, ...d.data() }));

      let created = 0, updated = 0, failed = 0;

      // 2. Process rows and map them intelligently to existing docs
      for (const row of rawRows) {
        const code = row.client_code ? String(row.client_code).trim() : "-";
        if (code === "-" || !row.client_name) { failed++; continue; }

        const tax = row.tax_status ? String(row.tax_status).trim().toUpperCase() : "-";
        const holding = row.holding_nature ? String(row.holding_nature).trim().toUpperCase() : "-";

        // Find existing documents for this client code
        const codeMatches = inMemoryDB.filter(c => c.client_code === code);
        let targetDoc = null;

        if (codeMatches.length > 0) {
          if (tax !== "-") {
            targetDoc = codeMatches.find(c => c.tax_status === tax);
          } else {
            targetDoc = codeMatches[0];
          }
        }

        // Determine if the row has any investment data
        const hasInv = row.scheme_name || row.folio_number || row.xsip_reg_no || row.installment_amount;
        
        let investmentData = null;
        if (hasInv) {
          // Parse xSIP strictly as a number to ensure we don't duplicate it later
          const parsedXSIP = parseXSIPAsNumber(row.xsip_reg_no);
          const finalXSIP = parsedXSIP ? parsedXSIP : `UNKNOWN-${Math.floor(Math.random()*10000)}`;

          // Extract amount cleanly (removes commas if any were left in excel formatting)
          let cleanAmount = row.installment_amount ? String(row.installment_amount).replace(/,/g, '').trim() : "-";

          investmentData = {
            xsip_reg_no: finalXSIP,
            folio_number: row.folio_number ? String(row.folio_number).trim() : "-",
            scheme_name: row.scheme_name ? String(row.scheme_name).trim() : "-",
            frequency_type: row.frequency_type ? String(row.frequency_type).trim() : "-",
            start_date: row.start_date ? String(row.start_date).trim() : "-",
            end_date: row.end_date ? String(row.end_date).trim() : "-",
            installment_amount: cleanAmount,
          };
        }

        if (targetDoc) {
          // Update the found document properties if the new file contains them
          if (tax !== "-") targetDoc.tax_status = tax;
          if (holding !== "-") targetDoc.holding_nature = holding;
          if (row.rm_assigned && row.rm_assigned !== "-") targetDoc.rm_assigned = row.rm_assigned;
          if (row.branch && row.branch !== "-") targetDoc.branch = row.branch;
          if (row.notes && row.notes !== "-") targetDoc.notes = row.notes;

          if (investmentData) {
            if (!targetDoc.investments) targetDoc.investments = [];
            
            // STRICT MATCHING: Find if the investment already exists by xSIP Number
            const idx = targetDoc.investments.findIndex(i => 
              !i.xsip_reg_no.startsWith("UNKNOWN") && 
              i.xsip_reg_no === investmentData.xsip_reg_no
            );

            if (idx >= 0) {
              // If it exists, UPDATE the specific fields but don't duplicate the array
              targetDoc.investments[idx] = {
                ...targetDoc.investments[idx],
                ...investmentData,
                scheme_name: investmentData.scheme_name !== "-" ? investmentData.scheme_name : targetDoc.investments[idx].scheme_name,
                installment_amount: investmentData.installment_amount !== "-" ? investmentData.installment_amount : targetDoc.investments[idx].installment_amount,
                folio_number: investmentData.folio_number !== "-" ? investmentData.folio_number : targetDoc.investments[idx].folio_number,
              };
            } else {
              // If it does NOT exist, push it as a new investment
              targetDoc.investments.push(investmentData); 
            }
          }
          targetDoc.isModified = true;
        } else {
          // Create a new document in memory
          const newDoc = {
            id: `new_${Math.random()}`,
            isNew: true,
            isModified: true,
            client_code: code,
            client_name: row.client_name ? String(row.client_name).trim() : "-",
            tax_status: tax,
            holding_nature: holding,
            rm_assigned: row.rm_assigned ? String(row.rm_assigned).trim() : "-",
            branch: row.branch ? String(row.branch).trim() : "-",
            notes: row.notes ? String(row.notes).trim() : "-",
            investments: investmentData ? [investmentData] : []
          };
          inMemoryDB.push(newDoc);
        }
      }

      // 3. Commit modifications to Firebase
      for (const docData of inMemoryDB.filter(d => d.isModified)) {
        const { id, isNew, isModified, ...cleanData } = docData;
        if (isNew) {
          await addDoc(collection(db, "clients"), { ...cleanData, created_at: serverTimestamp() });
          created++;
        } else {
          await updateDoc(doc(db, "clients", id), { ...cleanData, updated_at: serverTimestamp() });
          updated++;
        }
      }

      setResult({ created, updated, failed, total: rawRows.length });
      setStatus("done");
      setTimeout(() => onImportDone(), 2500);

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
          <p className="text-xs text-[#889995] mt-0.5">The system uses the <span className="font-bold text-white">xSIP Registration Number</span> to track individual investments. If you upload data with an existing xSIP number, it will securely update the existing record instead of creating a duplicate.</p>
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
            <p className="mt-1 text-xs text-[#889995]">{result.created} clients created · {result.updated} updated</p>
          </div>
        </div>
      )}

      {status !== "done" && (
        <div className="flex justify-end">
          <button onClick={handleUpload} disabled={!file || status === "loading"} className="px-5 py-2.5 rounded-xl font-bold text-sm bg-[#008254] text-white disabled:opacity-50 flex items-center justify-center transition-opacity">
            {status === "loading" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</> : "Import Clients"}
          </button>
        </div>
      )}
    </div>
  );
}