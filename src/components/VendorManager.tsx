import React, { useEffect, useState } from 'react';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';

const VendorManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadVendors = async () => {
    setLoading(true);
    const data = await api.getPendingVendors();
    setVendors(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const approve = async (id: string) => {
    await api.approveVendor(id);
    showToast('Vendor approved', 'success');
    loadVendors();
  };

  const reject = async (id: string) => {
    await api.rejectVendor(id);
    showToast('Vendor rejected', 'warning');
    loadVendors();
  };

  if (loading) return <div className="p-8">Loading vendors...</div>;

  return (
    <div className="p-8">
      <h2 className="text-2xl font-black mb-6">Pending Vendors</h2>

      {vendors.length === 0 && (
        <p className="text-slate-400">No pending vendors</p>
      )}

      {vendors.map(v => (
        <div
          key={v.id}
          className="flex justify-between items-center p-4 mb-3 rounded-xl border bg-white"
        >
          <div>
            <p className="font-bold">{v.name}</p>
            <p className="text-xs text-slate-400">{v.created_at}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => approve(v.id)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg"
            >
              Approve
            </button>

            <button
              onClick={() => reject(v.id)}
              className="px-4 py-2 bg-red-500 text-white rounded-lg"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VendorManager;
