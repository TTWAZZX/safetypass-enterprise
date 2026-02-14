import React, { useState, useEffect } from 'react';
import { User, WorkPermitSession } from '../types';
import { api as mockApi } from '../services/supabaseApi';
import { useTranslation } from '../context/LanguageContext';
import ExamSystem from './ExamSystem';
import {
  BookOpen,
  Lock,
  CheckCircle2,
  ChevronRight,
  Ticket,
  QrCode,
  X
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useToastContext } from './ToastProvider';

interface UserPanelProps {
  user: User;
  onUserUpdate: (user: User) => void;
}

const UserPanel: React.FC<UserPanelProps> = ({ user, onUserUpdate }) => {
  const { t } = useTranslation();
  const { showToast } = useToastContext(); // ✅ Hook ต้องอยู่ใน component เท่านั้น

  const [activeStage, setActiveStage] = useState<
    'IDLE' | 'INDUCTION' | 'WORK_PERMIT'
  >('IDLE');
  const [activePermit, setActivePermit] =
    useState<WorkPermitSession | null>(null);
  const [showQRFullScreen, setShowQRFullScreen] = useState(false);

  useEffect(() => {
    mockApi.getActiveWorkPermit(user.id).then((data) => {
      setActivePermit(data);
    });
  }, [user.id]);

  const hasInduction =
    user.induction_expiry &&
    new Date(user.induction_expiry) > new Date();

  const isNearExpiry =
    user.induction_expiry &&
    new Date(user.induction_expiry).getTime() -
      new Date().getTime() <
      30 * 24 * 60 * 60 * 1000;

  /* =========================
     HANDLE WORK PERMIT CLICK
  ========================== */

  const handleWorkPermitClick = () => {
    if (!hasInduction) {
      showToast('Please complete induction first', 'warning');
      return;
    }

    if (activePermit) {
      showToast('You already have an active permit', 'success');
      return;
    }

    setActiveStage('WORK_PERMIT');
  };

  /* =========================
     EXAM VIEW
  ========================== */

  if (activeStage !== 'IDLE') {
    return (
      <ExamSystem
        type={
          activeStage === 'INDUCTION'
            ? 'INDUCTION'
            : 'WORK_PERMIT'
        }
        user={user}
        onComplete={(u) => {
          onUserUpdate(u);
          setActiveStage('IDLE');
          showToast('Exam completed successfully', 'success');
        }}
        onBack={() => setActiveStage('IDLE')}
      />
    );
  }

  return (
    <>
      <div className="max-w-4xl mx-auto p-6 space-y-8">

        {/* =========================
           1️⃣ INDUCTION CARD
        ========================== */}

        <div
          onClick={() => {
            if (!hasInduction || isNearExpiry) {
              setActiveStage('INDUCTION');
            } else {
              showToast(
                'Your induction is still valid',
                'success'
              );
            }
          }}
          className={`p-8 rounded-3xl border-2 transition-all cursor-pointer ${
            hasInduction
              ? 'bg-emerald-50 border-emerald-100'
              : 'bg-white border-slate-100 hover:border-blue-200 shadow-sm'
          }`}
        >
          <div className="flex justify-between items-start mb-4">
            <div
              className={`p-3 rounded-xl ${
                hasInduction
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-blue-50 text-blue-600'
              }`}
            >
              <BookOpen className="w-6 h-6" />
            </div>

            {hasInduction ? (
              <CheckCircle2 className="text-emerald-500" />
            ) : (
              <ChevronRight className="text-slate-300" />
            )}
          </div>

          <h3 className="text-xl font-bold text-slate-900">
            {t('user.stage1')}
          </h3>
        </div>

        {/* =========================
           2️⃣ WORK PERMIT CARD
        ========================== */}

        <div
          onClick={handleWorkPermitClick}
          className={`p-8 rounded-3xl border-2 transition-all cursor-pointer ${
            !hasInduction
              ? 'opacity-50 grayscale border-slate-100 bg-slate-50'
              : activePermit
              ? 'bg-blue-600 text-white border-blue-600 shadow-xl'
              : 'bg-white border-slate-100 hover:border-blue-200 shadow-sm'
          }`}
        >
          <div className="flex justify-between items-start mb-4">
            <div
              className={`p-3 rounded-xl ${
                activePermit
                  ? 'bg-white/20 text-white'
                  : 'bg-purple-50 text-purple-600'
              }`}
            >
              {activePermit ? (
                <QrCode className="w-6 h-6" />
              ) : (
                <Ticket className="w-6 h-6" />
              )}
            </div>

            {!hasInduction && (
              <Lock className="text-slate-400" />
            )}
          </div>

          <h3 className="text-xl font-bold">
            {t('user.stage2')}
          </h3>

          {activePermit && (
            <div className="mt-6 bg-white p-4 rounded-xl flex items-center gap-4">
              <QRCodeSVG
                value={activePermit.permit_no}
                size={90}
              />
              <div>
                <p className="text-lg font-black">
                  {activePermit.permit_no}
                </p>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQRFullScreen(true);
                  }}
                  className="mt-3 text-xs font-bold bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700"
                >
                  Full Screen
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =========================
         FULLSCREEN QR
      ========================== */}

      {showQRFullScreen && activePermit && (
        <div
          className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center text-white"
          onClick={() => setShowQRFullScreen(false)}
        >
          <button
            onClick={() => setShowQRFullScreen(false)}
            className="absolute top-6 right-6 bg-white/10 p-3 rounded-full"
          >
            <X className="w-6 h-6" />
          </button>

          <QRCodeSVG
            value={activePermit.permit_no}
            size={300}
            bgColor="#000000"
            fgColor="#ffffff"
          />
        </div>
      )}
    </>
  );
};

export default UserPanel;
