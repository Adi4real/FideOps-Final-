import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, MessageSquare, X, Check, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUS_COLORS = {
  "Pending": "bg-gray-100 text-gray-600",
  "Under Process": "bg-blue-100 text-blue-700",
  "Waiting Client": "bg-amber-100 text-amber-700",
  "Completed": "bg-green-100 text-green-700",
  "Cancelled": "bg-red-100 text-red-600",
};

const PRIORITY_COLORS = {
  High: "bg-red-100 text-red-600 border-red-200",
  Medium: "bg-amber-100 text-amber-600 border-amber-200",
  Low: "bg-green-100 text-green-600 border-green-200",
};

const ALL_STATUSES = ["Pending", "Under Process", "Waiting Client", "Completed", "Cancelled"];

export default function TaskRow({ task, ageing, onStatusChange, onNotesUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState(task.reviewer_notes || "");

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
        <td className="px-4 py-3">
          <span className="font-mono text-xs font-semibold text-[#1E3A5F]">{task.task_id || "—"}</span>
        </td>
        <td className="px-4 py-3">
          <div>
            <p className="font-medium text-gray-800 text-xs">{task.client_name}</p>
            <p className="text-gray-400 text-xs">{task.client_code}</p>
          </div>
        </td>
        <td className="px-4 py-3">
          <div>
            <p className="text-gray-700 text-xs font-medium">{task.action}</p>
            <p className="text-gray-400 text-xs">{task.category}</p>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-gray-600">{task.assigned_to}</span>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-gray-600">
            {task.follow_up_date ? format(parseISO(task.follow_up_date), "dd MMM yyyy") : "—"}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", PRIORITY_COLORS[task.priority] || "bg-gray-100 text-gray-500")}>
            {task.priority}
          </span>
        </td>
        <td className="px-4 py-3">
          <Select value={task.status} onValueChange={v => onStatusChange(task, v)}>
            <SelectTrigger className={cn("h-7 text-xs border-0 px-2 rounded-full font-medium w-auto min-w-[110px]", STATUS_COLORS[task.status])}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_STATUSES.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className="px-4 py-3">
          <span className={cn("text-xs font-semibold", ageing > 7 ? "text-red-500" : ageing > 3 ? "text-amber-500" : "text-gray-400")}>
            {ageing}d
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600">
              <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
            </button>
            {onDelete && (
              <button
                onClick={() => { if (window.confirm("Delete this task permanently?")) onDelete(task); }}
                className="text-gray-300 hover:text-red-500 transition-colors ml-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-blue-50/30 border-b border-gray-100">
          <td colSpan={9} className="px-6 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-3">
              <div><span className="text-gray-400 block">Branch</span><span className="font-medium text-gray-700">{task.branch || "—"}</span></div>
              <div><span className="text-gray-400 block">RM Assigned</span><span className="font-medium text-gray-700">{task.rm_assigned || "—"}</span></div>
              <div><span className="text-gray-400 block">Channel</span><span className="font-medium text-gray-700">{task.channel || "—"}</span></div>
              <div><span className="text-gray-400 block">Amount</span><span className="font-medium text-gray-700">{task.amount ? `₹${task.amount.toLocaleString("en-IN")}` : "—"}</span></div>
              {task.product_name && <div><span className="text-gray-400 block">Product</span><span className="font-medium text-gray-700">{task.product_name}</span></div>}
              {task.notes && <div className="col-span-2"><span className="text-gray-400 block">Notes</span><span className="font-medium text-gray-700">{task.notes}</span></div>}
              {task.closure_date && <div><span className="text-gray-400 block">Closure Date</span><span className="font-medium text-gray-700">{format(parseISO(task.closure_date), "dd MMM yyyy")}</span></div>}
            </div>

            {/* Reviewer notes */}
            <div className="flex items-start gap-3 mt-2">
              <MessageSquare className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
              {editNotes ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#2E86AB]"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Add reviewer notes..."
                    autoFocus
                  />
                  <button onClick={() => { onNotesUpdate(task, notes); setEditNotes(false); }} className="text-green-500 hover:text-green-600"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditNotes(false)} className="text-red-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button onClick={() => setEditNotes(true)} className="text-xs text-gray-400 hover:text-[#2E86AB] text-left">
                  {task.reviewer_notes || "Add reviewer notes..."}
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}