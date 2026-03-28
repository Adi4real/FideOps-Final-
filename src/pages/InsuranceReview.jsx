import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom'; // Added useLocation
import * as XLSX from 'xlsx';
import { parse, isValid, format, isBefore, startOfDay, isSameMonth, parseISO } from 'date-fns';
import { UploadCloud, Trash2, CheckCircle, AlertCircle, Search, X, Edit2, Target, Clock } from 'lucide-react';

// FIREBASE IMPORTS
// ⚠️ Ensure this path points to your actual firebase.js config file
import { db } from '../firebase'; 
import { collection, doc, writeBatch, getDocs, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';

export default function InsuranceReview() {
  const location = useLocation(); // Hook to get router state

  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // UI States
  const [uploadSummary, setUploadSummary] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);
  const fileInputRef = useRef(null);

  // Filters - Initially populated by router state if it exists
  const [filters, setFilters] = useState({
    startDate: location.state?.filterStartDate || '',
    endDate: location.state?.filterEndDate || '',
    status: location.state?.filterStatus || 'All',
    planType: 'All',
    ecs: 'All',
    search: ''
  });

  // Stats Filter
  const [statsPlanType, setStatsPlanType] = useState('All');

  // --- Catch routing updates if user navigates to this page while already on it ---
  useEffect(() => {
    if (location.state) {
      setFilters(prev => ({
        ...prev,
        startDate: location.state.filterStartDate || prev.startDate,
        endDate: location.state.filterEndDate || prev.endDate,
        status: location.state.filterStatus || prev.status
      }));
    }
  }, [location.state]);

  // --- Date Helper ---
  // Parses DD/MM/YYYY or YYYY-MM-DD back and forth safely
  const parseDateString = (dateStr) => {
    if (!dateStr) return new Date(NaN);
    let parsed = parse(dateStr, 'dd/MM/yyyy', new Date());
    if (!isValid(parsed)) {
      parsed = new Date(dateStr);
    }
    return parsed;
  };

  // --- Firebase Fetch Data (Real-time listener) ---
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'insurance_policies'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), docId: doc.id }));
      setPolicies(data);
    });
    
    return () => unsubscribe();
  }, []);

  // --- Firebase Upload & Parsing Logic ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      // Dynamically find the long column name for Premium Amount
      const getPremium = (row) => {
        const key = Object.keys(row).find(k => k.includes('Last Premium Paid Amount') || k.includes('Gross Premium'));
        return row[key] || row['Due Premium ( 1 Year )'] || '';
      };

      const formattedData = rawJson.map(row => {
        // Enforce only Renewed or Not Renewed
        const rawStatus = String(row['Renewal Status'] || '').toLowerCase();
        const cleanStatus = rawStatus.includes('not') ? 'Not Renewed' : 'Renewed';

        return {
          srNo: String(row['Sr No.'] || '').trim(),
          planType: String(row['Plan Type'] || '').trim(),
          plan: String(row['Plan'] || '').trim(),
          policyNo: String(row['Existing Policy No.'] || '').trim(),
          policyHolder: String(row['Policy Holder'] || '').trim(),
          dueDate: String(row['Premium Due Date'] || '').trim(), 
          premiumAmount: getPremium(row),
          vehicleReg: String(row['Vehicle Regn No.'] || '').trim(),
          ecs: String(row['ECS/ Non ECS'] || '').trim(),
          renewalStatus: cleanStatus,
        };
      }).filter(p => {
        // FILTER OUT EMPTY POLICIES AND THE EXCEL "TOTAL" GHOST ROW
        const isTotalRow = 
          p.srNo.toLowerCase().includes('total') || 
          p.policyNo.toLowerCase().includes('total') || 
          p.policyHolder.toLowerCase().includes('total');
          
        return p.policyNo !== "" && !isTotalRow;
      }); 

      try {
        const policiesRef = collection(db, 'insurance_policies');
        const existingSnapshot = await getDocs(policiesRef);
        const existingPolicies = {};
        existingSnapshot.forEach(doc => { existingPolicies[doc.id] = doc.data(); });

        let batches = [writeBatch(db)];
        let batchIndex = 0;
        let opCount = 0;
        
        let newCount = 0;
        let updatedCount = 0; // Treated as Overwrites now

        for (const policy of formattedData) {
          const safeDocId = String(policy.policyNo).replace(/\//g, '-');
          const docRef = doc(policiesRef, safeDocId);
          const existing = existingPolicies[safeDocId];

          if (existing) {
            // OVERWRITE ENTIRELY based on policy number
            batches[batchIndex].set(docRef, policy);
            updatedCount++;
          } else {
            // NEW RECORD
            batches[batchIndex].set(docRef, policy);
            newCount++;
          }
          opCount++;

          // Firestore allows 500 operations per batch
          if (opCount >= 490) {
            batches.push(writeBatch(db));
            batchIndex++;
            opCount = 0;
          }
        }

        for (const b of batches) { await b.commit(); }
        setUploadSummary({ new: newCount, updated: updatedCount, skipped: 0 });
      } catch (error) {
        console.error("Firebase Upload failed:", error);
        alert("Failed to sync data with Firebase.");
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // --- Firebase Actions ---
  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedRows.length} selected records?`)) return;
    try {
      const batch = writeBatch(db);
      selectedRows.forEach(policyNo => {
        const safeDocId = String(policyNo).replace(/\//g, '-');
        batch.delete(doc(db, 'insurance_policies', safeDocId));
      });
      await batch.commit();
      setSelectedRows([]);
    } catch (e) {
      console.error("Bulk Delete Error:", e);
      alert("Failed to delete bulk records.");
    }
  };

  const handleDeleteSingle = async (policyNo) => {
    if (!window.confirm('Delete this record?')) return;
    try {
      const safeDocId = String(policyNo).replace(/\//g, '-');
      await deleteDoc(doc(db, 'insurance_policies', safeDocId));
    } catch (e) {
      console.error("Delete Error:", e);
      alert("Failed to delete record.");
    }
  };

  const handleInlineEdit = async (policyNo, field, value) => {
    setPolicies(policies.map(p => p.policyNo === policyNo ? { ...p, [field]: value } : p));
    try {
      const safeDocId = String(policyNo).replace(/\//g, '-');
      await updateDoc(doc(db, 'insurance_policies', safeDocId), { [field]: value });
    } catch (e) {
      console.error("Inline Update failed", e);
      alert("Failed to save changes.");
    }
  };

  const toggleRow = (id) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };

  // --- Filtering ---
  const filteredPolicies = policies.filter(p => {
    const pDate = parseDateString(p.dueDate);
    let matchDate = true;

    if (isValid(pDate)) {
      if (filters.startDate && filters.endDate) {
        matchDate = pDate >= new Date(filters.startDate) && pDate <= new Date(filters.endDate);
      } else if (filters.startDate) {
        matchDate = pDate >= new Date(filters.startDate);
      } else if (filters.endDate) {
        matchDate = pDate <= new Date(filters.endDate);
      }
    } else if (filters.startDate || filters.endDate) {
      matchDate = false;
    }

    const matchStatus = filters.status === 'All' || p.renewalStatus === filters.status;
    const matchPlan = filters.planType === 'All' || p.planType === filters.planType;
    const matchEcs = filters.ecs === 'All' || p.ecs === filters.ecs;
    const matchSearch = p.policyHolder.toLowerCase().includes(filters.search.toLowerCase()) || 
                        p.policyNo.toLowerCase().includes(filters.search.toLowerCase());
    
    return matchDate && matchStatus && matchPlan && matchEcs && matchSearch;
  });

  // --- Dynamic KPI Calculations ---
  // Apply the extra Plan Type filter specifically for the Total Premium calculation
  const statsFilteredPolicies = statsPlanType === 'All' 
    ? filteredPolicies 
    : filteredPolicies.filter(p => p.planType === statsPlanType);

  const totalPremiumValue = statsFilteredPolicies.reduce((sum, p) => {
    const val = parseFloat(String(p.premiumAmount).replace(/,/g, '')) || 0;
    return sum + val;
  }, 0);

  const kpis = {
    renewed: filteredPolicies.filter(p => p.renewalStatus?.toLowerCase().includes('renewed') && !p.renewalStatus?.toLowerCase().includes('not')).length,
    notRenewed: filteredPolicies.filter(p => p.renewalStatus?.toLowerCase().includes('not')).length,
    totalPremium: totalPremiumValue
  };

  const uniquePlanTypes = [...new Set(policies.map(p => p.planType).filter(Boolean))];
  const uniqueEcs = [...new Set(policies.map(p => p.ecs).filter(Boolean))];

  // Common UI styles
  const iStyle = "bg-[#050a09] border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-[#4ade80] placeholder-[#889995] transition-colors";
  const thStyle = "p-4 text-left text-[10px] font-bold text-[#889995] uppercase tracking-wider border-b border-white/10";
  const tdStyle = "p-4 text-[13px] font-semibold text-white border-b border-white/5";

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black, #0a1612)", minHeight: "100vh", color: "var(--text-main, #fff)" }}>
      
      {/* Header & Upload */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Insurance Review Dashboard</h1>
          <p className="text-sm mt-1 text-[#889995]">Track and manage policy renewals.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <input type="file" accept=".csv, .xlsx, .xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          <button 
            onClick={() => fileInputRef.current?.click()} 
            disabled={loading} 
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4ade80] text-black text-xs font-black shadow-[0_0_15px_rgba(74,222,128,0.3)] hover:scale-105 transition-all disabled:opacity-50"
          >
            <UploadCloud size={16} />
            {loading ? 'Processing...' : 'Upload Data File (Overwrite)'}
          </button>
        </div>
      </div>

      {/* Upload Summary Banner */}
      {uploadSummary && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-[#050a09] animate-in fade-in slide-in-from-top-4">
          <div className="flex gap-6">
            <span className="text-xs font-bold text-[#4ade80] flex items-center gap-1">🟢 {uploadSummary.new} New Records</span>
            <span className="text-xs font-bold text-[#fbbf24] flex items-center gap-1">🟡 {uploadSummary.updated} Overwritten</span>
          </div>
          <button onClick={() => setUploadSummary(null)} className="p-1 hover:bg-white/10 text-[#889995] rounded-lg transition-colors"><X size={16}/></button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-[#050a09] border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#4ade80]/5 rounded-full blur-2xl group-hover:bg-[#4ade80]/10 transition-colors" />
          <div className="flex items-center gap-3 text-[#4ade80] mb-3"><CheckCircle size={18} /><h3 className="font-bold uppercase tracking-wider text-[10px]">Renewed</h3></div>
          <p className="text-4xl font-black text-white">{kpis.renewed}</p>
        </div>
        
        <div className="p-6 rounded-2xl bg-[#050a09] border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#f87171]/5 rounded-full blur-2xl group-hover:bg-[#f87171]/10 transition-colors" />
          <div className="flex items-center gap-3 text-[#f87171] mb-3"><AlertCircle size={18} /><h3 className="font-bold uppercase tracking-wider text-[10px]">Not Renewed</h3></div>
          <p className="text-4xl font-black text-white">{kpis.notRenewed}</p>
        </div>

        {/* Premium Amount Card with Filter */}
        <div className="p-6 rounded-2xl bg-[#050a09] border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#60a5fa]/5 rounded-full blur-2xl group-hover:bg-[#60a5fa]/10 transition-colors" />
          <div className="flex items-start justify-between mb-2 relative z-10">
            <div className="flex items-center gap-3 text-[#60a5fa] mt-1">
              <Target size={18} />
              <h3 className="font-bold uppercase tracking-wider text-[10px]">Premium Amount</h3>
            </div>
            <select 
              value={statsPlanType} 
              onChange={e => setStatsPlanType(e.target.value)} 
              className="bg-[#0a1612] text-white text-[10px] font-bold border border-white/10 rounded-lg px-2 py-1 outline-none focus:border-[#60a5fa] cursor-pointer"
            >
              <option value="All">All Plans</option>
              {uniquePlanTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>
          </div>
          <p className="text-3xl font-black text-white mt-1 relative z-10">
            ₹ {kpis.totalPremium.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="p-5 rounded-2xl bg-[#0a1612] border border-white/10 space-y-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#889995]" />
              <input type="text" placeholder="Search Policy or Holder..." value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} className={`${iStyle} pl-10 w-48`} />
            </div>
            
            {/* Date Range Inputs */}
            <div className="flex items-center gap-2 bg-[#050a09] border border-white/10 rounded-xl px-1">
              <input 
                type="date" 
                value={filters.startDate} 
                onChange={e => setFilters({...filters, startDate: e.target.value})} 
                className="bg-transparent border-none text-white text-sm px-2 py-2.5 outline-none focus:text-[#4ade80] transition-colors w-[130px]" 
                style={{ colorScheme: 'dark' }} 
              />
              <span className="text-[#889995] text-xs font-bold">TO</span>
              <input 
                type="date" 
                value={filters.endDate} 
                onChange={e => setFilters({...filters, endDate: e.target.value})} 
                className="bg-transparent border-none text-white text-sm px-2 py-2.5 outline-none focus:text-[#4ade80] transition-colors w-[130px]" 
                style={{ colorScheme: 'dark' }} 
              />
            </div>
            
            <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className={iStyle}>
              <option value="All">All Statuses</option>
              <option value="Renewed">Renewed</option>
              <option value="Not Renewed">Not Renewed</option>
            </select>
            
            <select value={filters.planType} onChange={e => setFilters({...filters, planType: e.target.value})} className={iStyle}>
              <option value="All">All Plan Types</option>
              {uniquePlanTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>

            <select value={filters.ecs} onChange={e => setFilters({...filters, ecs: e.target.value})} className={iStyle}>
              <option value="All">All ECS/Non-ECS</option>
              {uniqueEcs.map(e => <option key={e} value={e}>{e}</option>)}
            </select>

            {(filters.startDate || filters.endDate || filters.status !== 'All' || filters.planType !== 'All' || filters.ecs !== 'All' || filters.search) && (
               <button onClick={() => setFilters({startDate: '', endDate: '', status: 'All', planType: 'All', ecs: 'All', search: ''})} className="text-xs text-[#889995] hover:text-white underline underline-offset-2 ml-2 transition-colors">
                 Clear Filters
               </button>
            )}
          </div>

          {selectedRows.length > 0 && (
            <button onClick={handleBulkDelete} className="flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-500/20 transition-all shrink-0">
              <Trash2 size={14} /> Delete Selected ({selectedRows.length})
            </button>
          )}
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#050a09]">
          <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
            <thead className="bg-[#0a1612]">
              <tr>
                <th className={`${thStyle} w-10 text-center`}>
                  <input type="checkbox" onChange={e => setSelectedRows(e.target.checked ? filteredPolicies.map(p => p.policyNo) : [])} checked={selectedRows.length === filteredPolicies.length && filteredPolicies.length > 0} className="rounded cursor-pointer accent-[#4ade80]" />
                </th>
                <th className={thStyle}>Policy No.</th>
                <th className={thStyle}>Policy Holder</th>
                <th className={thStyle}>Plan Type</th>
                <th className={thStyle}>Due Date (DD/MM/YYYY)</th>
                <th className={thStyle}>Premium Amount</th>
                <th className={thStyle}>ECS/Non ECS</th>
                <th className={thStyle}>Status</th>
                <th className={`${thStyle} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPolicies.length === 0 ? (
                <tr><td colSpan="9" className="p-10 text-center text-[#889995] italic text-xs">No policies match your filters.</td></tr>
              ) : (
                filteredPolicies.map((row) => (
                  <tr key={row.policyNo} className="hover:bg-white/5 transition-colors group">
                    <td className={`${tdStyle} text-center`}>
                      <input type="checkbox" checked={selectedRows.includes(row.policyNo)} onChange={() => toggleRow(row.policyNo)} className="rounded cursor-pointer accent-[#4ade80]" />
                    </td>
                    <td className={`${tdStyle} font-mono text-[#4ade80]`}>{row.policyNo}</td>
                    <td className={`${tdStyle} text-[#c8d4d0]`}>{row.policyHolder}</td>
                    <td className={`${tdStyle} text-[#889995]`}>{row.planType}</td>
                    
                    {/* Inline Editable Date (DD/MM/YYYY) */}
                    <td className={tdStyle}>
                      <div className="flex items-center gap-2 group-hover:bg-black/40 rounded px-2 -ml-2 transition-colors border border-transparent group-hover:border-white/5">
                        <input type="text" value={row.dueDate} onChange={(e) => handleInlineEdit(row.policyNo, 'dueDate', e.target.value)} className="bg-transparent border-none outline-none w-24 py-1 text-white placeholder-[#889995]" />
                        <Edit2 size={12} className="opacity-0 group-hover:opacity-50 text-[#889995]" />
                      </div>
                    </td>
                    
                    {/* Inline Editable Premium Amount */}
                    <td className={tdStyle}>
                       <div className="flex items-center gap-2 group-hover:bg-black/40 rounded px-2 -ml-2 transition-colors border border-transparent group-hover:border-white/5">
                        <input type="text" value={row.premiumAmount} onChange={(e) => handleInlineEdit(row.policyNo, 'premiumAmount', e.target.value)} className="bg-transparent border-none outline-none w-24 py-1 text-white placeholder-[#889995]" />
                        <Edit2 size={12} className="opacity-0 group-hover:opacity-50 text-[#889995]" />
                      </div>
                    </td>

                    <td className={`${tdStyle} text-[#889995]`}>{row.ecs}</td>
                    
                    {/* Visual Status Dropdown */}
                    <td className={tdStyle}>
                      <select 
                        value={row.renewalStatus} 
                        onChange={(e) => handleInlineEdit(row.policyNo, 'renewalStatus', e.target.value)} 
                        className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-lg outline-none cursor-pointer appearance-none text-center min-w-[110px] border transition-colors
                          ${row.renewalStatus?.toLowerCase().includes('renewed') && !row.renewalStatus?.toLowerCase().includes('not') 
                            ? 'bg-[#4ade80]/10 text-[#4ade80] border-[#4ade80]/20 hover:bg-[#4ade80]/20' 
                            : 'bg-[#f87171]/10 text-[#f87171] border-[#f87171]/20 hover:bg-[#f87171]/20'}`}
                      >
                        <option value="Renewed" className="bg-[#0a1612] text-white">Renewed</option>
                        <option value="Not Renewed" className="bg-[#0a1612] text-white">Not Renewed</option>
                      </select>
                    </td>
                    
                    <td className={`${tdStyle} text-right`}>
                      <button onClick={() => handleDeleteSingle(row.policyNo)} className="text-[#889995] hover:text-[#f87171] hover:bg-[#f87171]/10 p-2 rounded-lg transition-all">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}