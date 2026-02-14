import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { useTranslation } from '../context/LanguageContext';
import Skeleton from './Skeleton';
import QuestionManager from './QuestionManager';
import VendorManager from './VendorManager';
import SettingsManager from './SettingsManager';

import {
  LayoutGrid,
  ClipboardList,
  Building2,
  Settings,
  CheckCircle,
  XCircle
} from 'lucide-react';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

const COLORS = ['#10b981', '#ef4444'];

const AdminPanel: React.FC = () => {
  const { t } = useTranslation();

  const [stats, setStats] = useState<any>(null);
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] =
    useState<'DASHBOARD' | 'QUESTIONS' | 'VENDORS' | 'SETTINGS'>('DASHBOARD');

  const fetchData = async () => {
    try {
      setLoading(true);

      const dashboard = await api.getDashboardStats();
      const report = await api.getReportData();

      setStats(dashboard);
      setReportData(report);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const examTypeSummary = [
    {
      name: 'Induction',
      value: reportData.filter(r => r.exam_type === 'INDUCTION').length
    },
    {
      name: 'Work Permit',
      value: reportData.filter(r => r.exam_type === 'WORK_PERMIT').length
    }
  ];

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-80px)]">
        <main className="flex-1 p-8 space-y-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-80px)] bg-slate-50 dark:bg-slate-900">

      {/* SIDEBAR */}
      <aside className="w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 p-6 hidden md:block">
        <h2 className="text-xl font-black text-slate-900 dark:text-white mb-8">
          Admin Panel
        </h2>

        <nav className="space-y-2">

          <SidebarButton
            icon={<LayoutGrid className="w-4 h-4" />}
            label="Dashboard"
            active={activePage === 'DASHBOARD'}
            onClick={() => setActivePage('DASHBOARD')}
          />

          <SidebarButton
            icon={<ClipboardList className="w-4 h-4" />}
            label="Questions"
            active={activePage === 'QUESTIONS'}
            onClick={() => setActivePage('QUESTIONS')}
          />

          <SidebarButton
            icon={<Building2 className="w-4 h-4" />}
            label="Vendors"
            active={activePage === 'VENDORS'}
            onClick={() => setActivePage('VENDORS')}
          />

          <SidebarButton
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
            active={activePage === 'SETTINGS'}
            onClick={() => setActivePage('SETTINGS')}
          />

        </nav>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-8">

        {activePage === 'DASHBOARD' && (
          <>
            {/* STATS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">

              <StatCard
                title="Total Users"
                value={stats?.totalUsers || 0}
                highlight="bg-blue-600 text-white"
              />

              <StatCard
                title="Active Permits"
                value={stats?.activePermits || 0}
                highlight="text-emerald-600"
              />

              <StatCard
                title="Pending Vendors"
                value={stats?.pendingVendors || 0}
                highlight="text-orange-500"
              />

            </div>

            {/* CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

              <div className="card">
                <h3 className="card-title">Exam Result Overview</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats?.examSummary || []}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={100}
                      label
                    >
                      {(stats?.examSummary || []).map((entry: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3 className="card-title">Exam Type Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={examTypeSummary}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#2563eb" radius={[8,8,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

            </div>

            {/* TABLE */}
            <div className="card">
              <h3 className="card-title">Recent Exam History</h3>

              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Exam</th>
                    <th className="px-4 py-3 text-left">Score</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.slice(0, 10).map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-200 dark:border-slate-800">
                      <td className="px-4 py-4 font-bold">{row.name}</td>
                      <td className="px-4 py-4">{row.exam_type}</td>
                      <td className="px-4 py-4 font-bold">{row.score}</td>
                      <td className="px-4 py-4">
                        {row.result === 'PASSED' ? (
                          <span className="flex items-center gap-1 text-emerald-600 font-bold">
                            <CheckCircle className="w-4 h-4" /> PASS
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-500 font-bold">
                            <XCircle className="w-4 h-4" /> FAIL
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activePage === 'QUESTIONS' && <QuestionManager />}
        {activePage === 'VENDORS' && <VendorManager />}
        {activePage === 'SETTINGS' && <SettingsManager />}
      </main>
    </div>
  );
};

export default AdminPanel;


/* ================================
   COMPONENT HELPERS
================================ */

const SidebarButton = ({ icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`}
  >
    {icon}
    {label}
  </button>
);

const StatCard = ({ title, value, highlight }: any) => (
  <div className={`bg-white dark:bg-slate-950 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 ${highlight}`}>
    <h3 className="text-sm uppercase tracking-widest text-slate-400">
      {title}
    </h3>
    <p className="text-4xl font-black mt-2">
      {value}
    </p>
  </div>
);

