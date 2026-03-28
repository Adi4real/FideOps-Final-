import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { parse, isBefore, startOfDay, isValid } from 'date-fns';
import { UploadCloud, Trash2, CheckCircle, AlertCircle, Clock, Search, X, Edit2 } from 'lucide-react';

// FIREBASE IMPORTS
// ⚠️ Ensure this path points to your actual firebase.js config file
import { db } from '../firebase'; 
import { collection, doc, writeBatch, getDocs, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';

export default function InsuranceReview() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // UI States
  const [uploadSummary, setUploadSummary] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);
  const fileInputRef = useRef(null);

  // Filters - By default, dates are empty so it shows EVERYTHING
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    status: 'All',
    planType: 'All',
    ecs: 'All',
    search: ''
  });

  // --- Date Helper ---
  const parseDateString = (dateStr) => {
    if (!dateStr) return new Date(NaN);
    let parsed = new Date(dateStr);
    if (!isValid(parsed)) {
      parsed = parse(dateStr, 'dd-MMM-yyyy', new Date());
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

      const formattedData = rawJson.map(row => ({
        srNo: row['Sr No.'] || '',
        planType: row['Plan Type'] || '',
        plan: row['Plan'] || '',
        policyNo: row['Existing Policy No.'] || '',
        policyHolder: row['Policy Holder'] || '',
        dueDate: row['Premium Due Date'] || '',
        duePremium: row['Due Premium ( 1 Year )'] || '',
        vehicleReg: row['Vehicle Regn No.'] || '',
        grossPremium: row['Last Premium Paid Amount / Premium Due Amount (Gross Premium) '] || '',
        ecs: row['ECS/ Non ECS'] || '',
        renewalNotice: row['Renewal Notice '] || '',
        noticeRemark: row['Renewal Notice Remark'] || '',
        renewalStatus: row['Renewal Status'] || 'Pending',
        newPolicyNo: row['New Policy Number'] || '',
        renewedGross: row['Renewed Gross Premium '] || '',
        renewedNet: row['Renewed Net Premium'] || '',
        lastIntimation: row['Last Intimation Sent date '] || ''
      })).filter(p => p.policyNo !== ""); 

      try {
        const policiesRef = collection(db, 'insurance_policies');
        const existingSnapshot = await getDocs(policiesRef);
        const existingPolicies = {};
        existingSnapshot.forEach(doc => { existingPolicies[doc.id] = doc.data(); });

        let batches = [writeBatch(db)];
        let batchIndex = 0;
        let opCount = 0;
        
        let newCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (const policy of formattedData) {
          const safeDocId = String(policy.policyNo).replace(/\//g, '-');
          const docRef = doc(policiesRef, safeDocId);
          const existing = existingPolicies[safeDocId];

          if (existing) {
            if (existing.renewalStatus !== policy.renewalStatus || 
                existing.dueDate !== policy.dueDate || 
                existing.duePremium !== policy.duePremium) {
              batches[batchIndex].update(docRef, policy);
              updatedCount++;
              opCount++;
            } else {
              skippedCount++;
            }
          } else {
            batches[batchIndex].set(docRef, policy);
            newCount++;
            opCount++;
          }

          if (opCount >= 490) {
            batches.push(writeBatch(db));
            batchIndex++;
            opCount = 0;
          }
        }

        for (const b of batches) { await b.commit(); }
        setUploadSummary({ new: newCount, updated: updatedCount, skipped: skippedCount });
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

  // --- Filtering (Now supports Date Range) ---
  const filteredPolicies = policies.filter(p => {
    const pDate = parseDateString(p.dueDate);
    let matchDate = true;

    // Check Date Range if either start or end is provided
    if (isValid(pDate)) {
      const policyDateStart = startOfDay(pDate);
      if (filters.startDate && filters.endDate) {
        matchDate = policyDateStart >= startOfDay(new Date(filters.startDate)) && 
                    policyDateStart <= startOfDay(new Date(filters.endDate));
      } else if (filters.startDate) {
        matchDate = policyDateStart >= startOfDay(new Date(filters.startDate));
      } else if (filters.endDate) {
        matchDate = policyDateStart <= startOfDay(new Date(filters.endDate));
      }
    } else if (filters.startDate || filters.endDate) {
      // If a filter is applied but the policy has a bad date, filter it out
      matchDate = false;
    }

    const matchStatus = filters.status === 'All' || p.renewalStatus === filters.status;
    const matchPlan = filters.planType === 'All' || p.planType === filters.planType;
    const matchEcs = filters.ecs === 'All' || p.ecs === filters.ecs;
    const matchSearch = p.policyHolder.toLowerCase().includes(filters.search.toLowerCase()) || 
                        p.policyNo.toLowerCase().includes(filters.search.toLowerCase());
    
    return matchDate && matchStatus && matchPlan && matchEcs && matchSearch;
  });

  // --- Dynamic KPI Calculations (Based on Filtered Data) ---
  const today = startOfDay(new Date());

  const kpis = {
    renewed: filteredPolicies.filter(p => p.renewalStatus?.toLowerCase().includes('renewed') && !p.renewalStatus?.toLowerCase().includes('not')).length,
    overdue: filteredPolicies.filter(p => {
      const dDate = parseDateString(p.dueDate);
      const isNotRenewed = p.renewalStatus?.toLowerCase().includes('not') || p.renewalStatus?.toLowerCase().includes('pending') || !p.renewalStatus?.toLowerCase().includes('renewed');
      return isNotRenewed && isValid(dDate) && isBefore(dDate, today);
    }).length,
    left: filteredPolicies.filter(p => {
      const dDate = parseDateString(p.dueDate);
      const isNotRenewed = p.renewalStatus?.toLowerCase().includes('not') || p.renewalStatus?.toLowerCase().includes('pending') || !p.renewalStatus?.toLowerCase().includes('renewed');
      return isNotRenewed && isValid(dDate) && !isBefore(dDate, today);
    }).length,
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
            {loading ? 'Processing...' : 'Upload Data File'}
          </button>
        </div>
      </div>

      {/* Upload Summary Banner */}
      {uploadSummary && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-[#050a09] animate-in fade-in slide-in-from-top-4">
          <div className="flex gap-6">
            <span className="text-xs font-bold text-[#4ade80] flex items-center gap-1">🟢 {uploadSummary.new} New Records</span>
            <span className="text-xs font-bold text-[#fbbf24] flex items-center gap-1">🟡 {uploadSummary.updated} Updated</span>
            <span className="text-xs font-bold text-[#889995] flex items-center gap-1">⚪ {uploadSummary.skipped} Skipped</span>
          </div>
          <button onClick={() => setUploadSummary(null)} className="p-1 hover:bg-white/10 text-[#889995] rounded-lg transition-colors"><X size={16}/></button>
        </div>
      )}

      {/* KPI Cards (Now reflect the applied filters) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-[#050a09] border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#4ade80]/5 rounded-full blur-2xl group-hover:bg-[#4ade80]/10 transition-colors" />
          <div className="flex items-center gap-3 text-[#4ade80] mb-3"><CheckCircle size={18} /><h3 className="font-bold uppercase tracking-wider text-[10px]">Renewed</h3></div>
          <p className="text-4xl font-black text-white">{kpis.renewed}</p>
        </div>
        
        <div className="p-6 rounded-2xl bg-[#050a09] border border-white/10 relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-24 h-24 bg-[#fbbf24]/5 rounded-full blur-2xl group-hover:bg-[#fbbf24]/10 transition-colors" />
          <div className="flex items-center gap-3 text-[#fbbf24] mb-3"><Clock size={18} /><h3 className="font-bold uppercase tracking-wider text-[10px]">Left (Pending)</h3></div>
          <p className="text-4xl font-black text-white">{kpis.left}</p>
        </div>

        <div className="p-6 rounded-2xl bg-[#050a09] border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#f87171]/5 rounded-full blur-2xl group-hover:bg-[#f87171]/10 transition-colors" />
          <div className="flex items-center gap-3 text-[#f87171] mb-3"><AlertCircle size={18} /><h3 className="font-bold uppercase tracking-wider text-[10px]">Overdue</h3></div>
          <p className="text-4xl font-black text-white">{kpis.overdue}</p>
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
                title="Start Date"
              />
              <span className="text-[#889995] text-xs font-bold">TO</span>
              <input 
                type="date" 
                value={filters.endDate} 
                onChange={e => setFilters({...filters, endDate: e.target.value})} 
                className="bg-transparent border-none text-white text-sm px-2 py-2.5 outline-none focus:text-[#4ade80] transition-colors w-[130px]" 
                style={{ colorScheme: 'dark' }} 
                title="End Date"
              />
            </div>
            
            <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className={iStyle}>
              <option value="All">All Statuses</option>
              <option value="Renewed">Renewed</option>
              <option value="Not Renewed">Not Renewed</option>
              <option value="Pending">Pending</option>
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
                <th className={thStyle}>Due Date</th>
                <th className={thStyle}>Due Premium</th>
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
                    
                    {/* Inline Editable Date */}
                    <td className={tdStyle}>
                      <div className="flex items-center gap-2 group-hover:bg-black/40 rounded px-2 -ml-2 transition-colors border border-transparent group-hover:border-white/5">
                        <input type="text" value={row.dueDate} onChange={(e) => handleInlineEdit(row.policyNo, 'dueDate', e.target.value)} className="bg-transparent border-none outline-none w-24 py-1 text-white placeholder-[#889995]" />
                        <Edit2 size={12} className="opacity-0 group-hover:opacity-50 text-[#889995]" />
                      </div>
                    </td>
                    
                    {/* Inline Editable Premium */}
                    <td className={tdStyle}>
                       <div className="flex items-center gap-2 group-hover:bg-black/40 rounded px-2 -ml-2 transition-colors border border-transparent group-hover:border-white/5">
                        <input type="text" value={row.duePremium} onChange={(e) => handleInlineEdit(row.policyNo, 'duePremium', e.target.value)} className="bg-transparent border-none outline-none w-20 py-1 text-white placeholder-[#889995]" />
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
                            : row.renewalStatus?.toLowerCase().includes('not') 
                              ? 'bg-[#f87171]/10 text-[#f87171] border-[#f87171]/20 hover:bg-[#f87171]/20' 
                              : 'bg-[#fbbf24]/10 text-[#fbbf24] border-[#fbbf24]/20 hover:bg-[#fbbf24]/20'}`}
                      >
                        <option value="Renewed" className="bg-[#0a1612] text-white">Renewed</option>
                        <option value="Not Renewed" className="bg-[#0a1612] text-white">Not Renewed</option>
                        <option value="Pending" className="bg-[#0a1612] text-white">Pending</option>
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