import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { format, parse, isSameMonth, isBefore, startOfDay, isValid, parseISO } from 'date-fns';
import { UploadCloud, Trash2, CheckCircle, AlertCircle, Clock, Search, X, Edit2 } from 'lucide-react';

export default function InsuranceReview() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // UI States
  const [uploadSummary, setUploadSummary] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);
  const fileInputRef = useRef(null);

  // Filters
  const [filters, setFilters] = useState({
    month: format(new Date(), 'yyyy-MM'),
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

  // --- Upload & Parsing Logic ---
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
        const response = await fetch('/api/insurance/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policies: formattedData })
        });
        const result = await response.json();
        
        setUploadSummary(result.summary);
        fetchPolicies(); 
      } catch (error) {
        console.error("Upload failed:", error);
        alert("Failed to sync data with server. Ensure backend is running.");
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // --- Fetch Data ---
  const fetchPolicies = async () => {
    // Replace with your actual GET endpoint
    // const res = await fetch('/api/insurance');
    // const data = await res.json();
    // setPolicies(data);
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  // --- KPI Calculations ---
  const today = startOfDay(new Date());
  const targetMonthDate = filters.month ? parseISO(`${filters.month}-01`) : new Date();

  const currentMonthPolicies = policies.filter(p => {
    const dDate = parseDateString(p.dueDate);
    return isValid(dDate) && isSameMonth(dDate, targetMonthDate);
  });

  const kpis = {
    renewed: currentMonthPolicies.filter(p => p.renewalStatus?.toLowerCase().includes('renewed')).length,
    overdue: currentMonthPolicies.filter(p => {
      const dDate = parseDateString(p.dueDate);
      return !p.renewalStatus?.toLowerCase().includes('renewed') && isBefore(dDate, today);
    }).length,
    left: currentMonthPolicies.filter(p => {
      const dDate = parseDateString(p.dueDate);
      return !p.renewalStatus?.toLowerCase().includes('renewed') && !isBefore(dDate, today);
    }).length,
  };

  // --- Filtering ---
  const filteredPolicies = policies.filter(p => {
    const matchMonth = filters.month ? isSameMonth(parseDateString(p.dueDate), targetMonthDate) : true;
    const matchStatus = filters.status === 'All' || p.renewalStatus === filters.status;
    const matchPlan = filters.planType === 'All' || p.planType === filters.planType;
    const matchEcs = filters.ecs === 'All' || p.ecs === filters.ecs;
    const matchSearch = p.policyHolder.toLowerCase().includes(filters.search.toLowerCase()) || 
                        p.policyNo.toLowerCase().includes(filters.search.toLowerCase());
    return matchMonth && matchStatus && matchPlan && matchEcs && matchSearch;
  });

  // --- Actions ---
  const toggleRow = (id) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedRows.length} selected records?`)) return;
    setPolicies(policies.filter(p => !selectedRows.includes(p.policyNo)));
    const idsToDelete = [...selectedRows];
    setSelectedRows([]);
    await fetch('/api/insurance/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policyIds: idsToDelete })
    });
  };

  const handleDeleteSingle = async (id) => {
    if (!window.confirm('Delete this record?')) return;
    setPolicies(policies.filter(p => p.policyNo !== id));
    await fetch(`/api/insurance/${id}`, { method: 'DELETE' });
  };

  const handleInlineEdit = async (id, field, value) => {
    setPolicies(policies.map(p => p.policyNo === id ? { ...p, [field]: value } : p));
    await fetch(`/api/insurance/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
  };

  const uniquePlanTypes = [...new Set(policies.map(p => p.planType).filter(Boolean))];
  const uniqueEcs = [...new Set(policies.map(p => p.ecs).filter(Boolean))];

  // Common styles to match your theme
  const iStyle = "bg-[#050a09] border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-[#4ade80] placeholder-[#889995] transition-colors";
  const thStyle = "p-4 text-left text-[10px] font-bold text-[#889995] uppercase tracking-wider border-b border-white/10";
  const tdStyle = "p-4 text-[13px] font-semibold text-white border-b border-white/5";

  return (
    <div className="p-4 lg:p-8 space-y-6" style={{ background: "var(--bg-black, #0a1612)", minHeight: "100vh", color: "var(--text-main, #fff)" }}>
      
      {/* Header & Upload */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Insurance Review Dashboard</h1>
          <p className="text-sm mt-1 text-[#889995]">Track and manage monthly policy renewals.</p>
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

      {/* KPI Cards */}
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
              <input type="text" placeholder="Search Policy or Holder..." value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} className={`${iStyle} pl-10 w-64`} />
            </div>
            
            <input type="month" value={filters.month} onChange={e => setFilters({...filters, month: e.target.value})} className={iStyle} style={{ colorScheme: 'dark' }} />
            
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
          </div>

          {selectedRows.length > 0 && (
            <button onClick={handleBulkDelete} className="flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-500/20 transition-all">
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