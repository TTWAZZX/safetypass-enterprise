import React, { useEffect, useState } from 'react';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';

const SettingsManager: React.FC = () => {
  const { showToast } = useToastContext();

  const [inductionScore, setInductionScore] = useState(80);
  const [workPermitScore, setWorkPermitScore] = useState(70);

  const loadSettings = async () => {
    const data = await api.getSystemSettings();
    setInductionScore(Number(data.induction_passing_score || 80));
    setWorkPermitScore(Number(data.work_permit_passing_score || 70));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const save = async () => {
    await api.updateSystemSetting('induction_passing_score', inductionScore);
    await api.updateSystemSetting('work_permit_passing_score', workPermitScore);
    showToast('Settings updated', 'success');
  };

  return (
    <div className="p-8 max-w-xl">
      <h2 className="text-2xl font-black mb-6">Exam Settings</h2>

      <div className="mb-4">
        <label className="block font-bold mb-2">
          Induction Passing Score
        </label>
        <input
          type="number"
          value={inductionScore}
          onChange={e => setInductionScore(Number(e.target.value))}
          className="w-full p-3 border rounded-lg"
        />
      </div>

      <div className="mb-6">
        <label className="block font-bold mb-2">
          Work Permit Passing Score
        </label>
        <input
          type="number"
          value={workPermitScore}
          onChange={e => setWorkPermitScore(Number(e.target.value))}
          className="w-full p-3 border rounded-lg"
        />
      </div>

      <button
        onClick={save}
        className="px-6 py-3 bg-blue-600 text-white rounded-xl"
      >
        Save Settings
      </button>
    </div>
  );
};

export default SettingsManager;
