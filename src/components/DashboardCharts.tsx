import React from 'react';
import { Building2, LineChart as LineChartIcon, PieChart as PieChartIcon, TrendingUp } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

interface DashboardChartsProps {
  chartData: {
    pieData: Array<{ name: string; value: number; color: string }>;
    barData: any[];
    trendData: any[];
    vendorData: any[];
  };
}

const DashboardCharts: React.FC<DashboardChartsProps> = ({ chartData }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-700">
      <div className="lg:col-span-2 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 flex justify-between items-center">
          <span className="flex items-center gap-2"><LineChartIcon size={14} className="text-blue-500" /> Daily Traffic Trend <span className="hidden sm:inline text-[9px] text-slate-300 ml-1">| แนวโน้มรายวัน</span></span>
        </h3>
        <div className="w-full h-[180px] sm:h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData.trendData} margin={{ top: 5, right: 10, left: -30, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip isAnimationActive={false} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
              <Line isAnimationActive={false} type="monotone" dataKey="Exams" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5, fill: '#3b82f6' }} name="จำนวนผู้เข้าสอบ" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="lg:col-span-1 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col h-[280px] sm:h-auto overflow-hidden">
        <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 flex justify-between items-center">
          <span className="flex items-center gap-2"><Building2 size={14} className="text-amber-500" /> Top Vendors <span className="hidden sm:inline text-[9px] text-slate-300 ml-1">| จัดอันดับบริษัท</span></span>
        </h3>
        <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-2 no-scrollbar sm:gap-4 sm:overflow-y-visible">
          {chartData.vendorData.map((vendor: any, index: number) => (
            <div key={`${vendor.name}-${index}`} className="flex items-center gap-3 group">
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-[10px] sm:text-xs text-slate-500 flex-shrink-0 group-hover:bg-amber-100 group-hover:text-amber-600 transition-colors">{index + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-end mb-1"><p className="font-bold text-[10px] sm:text-xs text-slate-800 truncate uppercase" title={vendor.name}>{vendor.name}</p><p className="text-[10px] sm:text-xs font-black text-slate-600 ml-2 tabular-nums">{vendor.total}</p></div>
                <div className="w-full bg-slate-100 h-1 sm:h-1.5 rounded-full overflow-hidden flex"><div style={{ width: `${(vendor.passed / vendor.total) * 100}%` }} className="h-full bg-emerald-400" /><div style={{ width: `${(vendor.failed / vendor.total) * 100}%` }} className="h-full bg-red-400" /></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-6 duration-700">
      <div className="lg:col-span-1 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center">
        <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 w-full flex justify-between items-center"><span className="flex items-center gap-2"><PieChartIcon size={14} className="text-emerald-500" /> Pass / Fail Ratio</span></h3>
        <div className="w-full h-[180px] sm:h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie isAnimationActive={false} data={chartData.pieData} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">{chartData.pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}</Pie><Tooltip isAnimationActive={false} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} itemStyle={{ fontWeight: 'bold', fontSize: '11px' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} /></PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="lg:col-span-2 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 flex items-center gap-2"><TrendingUp size={14} className="text-purple-500" /> Performance by Module <span className="hidden sm:inline text-[9px] text-slate-300 ml-1">| แยกตามหลักสูตร</span></h3>
        <div className="w-full h-[180px] sm:h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.barData} margin={{ top: 10, right: 0, left: -30, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 8, fontWeight: 'bold', fill: '#94a3b8' }} interval={0} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} allowDecimals={false} /><Tooltip isAnimationActive={false} cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} /><Legend wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} /><Bar isAnimationActive={false} dataKey="Passed" name="ผ่าน (Pass)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} /><Bar isAnimationActive={false} dataKey="Failed" name="ไม่ผ่าน (Fail)" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} /></BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  </div>
);

export default DashboardCharts;
