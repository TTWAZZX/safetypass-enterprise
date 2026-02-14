import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { User, Question, ExamType } from '../types';
import { useTranslation } from '../context/LanguageContext';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText
} from 'lucide-react';

interface ExamSystemProps {
  type: ExamType;
  user: User;
  onComplete: (user: User) => void;
  onBack: () => void;
}

const ExamSystem: React.FC<ExamSystemProps> = ({
  type,
  user,
  onComplete,
  onBack
}) => {
  const { t, language } = useTranslation();

  const [step, setStep] =
    useState<'READ' | 'EXAM' | 'RESULT'>('READ');
  const [permitNo, setPermitNo] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasReadManual, setHasReadManual] = useState(false);

  useEffect(() => {
    api.getQuestions(type).then(setQuestions);
  }, [type]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } =
      e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 20) {
      setHasReadManual(true);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    let correctCount = 0;

    questions.forEach(q => {
      const selectedIdx = answers[q.id];
      const correctIdx = q.choices_json.findIndex(
        c => c.is_correct
      );
      if (selectedIdx === correctIdx) correctCount++;
    });

    const isPassed =
      type === 'INDUCTION'
        ? correctCount >= 8
        : correctCount >= 7;

    setScore(correctCount);
    setPassed(isPassed);

    await api.submitExam(
      user.id,
      type,
      correctCount,
      isPassed,
      permitNo
    );

    setLoading(false);
    setStep('RESULT');

    if (isPassed) {
      const updatedUser = { ...user };
      const now = new Date();

      if (type === 'INDUCTION') {
        const nextYear = new Date(now);
        nextYear.setFullYear(now.getFullYear() + 1);
        updatedUser.induction_expiry =
          nextYear.toISOString();
      }

      setTimeout(() => onComplete(updatedUser), 2000);
    }
  };

  /* ================= READ STEP ================= */

  if (step === 'READ') {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-slate-950 rounded-3xl shadow-lg border border-slate-200 dark:border-slate-800 transition-colors">

        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mb-4 font-bold text-xs uppercase"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

        <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-4">
          {t('user.manual')}
        </h2>

        <div
          onScroll={handleScroll}
          className="h-96 bg-slate-50 dark:bg-slate-900 rounded-xl border-2 border-slate-200 dark:border-slate-800 mb-6 overflow-y-auto p-8 text-slate-600 dark:text-slate-300 space-y-4 shadow-inner transition-colors"
        >
          <div className="flex flex-col items-center justify-center py-6 text-slate-400 border-b border-slate-200 dark:border-slate-800 mb-4">
            <FileText className="w-12 h-12 mb-2 opacity-50" />
            <h3 className="text-lg font-bold">
              Safety Manual : {type}
            </h3>
            <p className="text-xs">
              Please read carefully before taking the exam.
            </p>
          </div>

          {[...Array(8)].map((_, i) => (
            <div key={i}>
              <h4 className="font-bold text-slate-800 dark:text-white text-sm mb-1">
                Rule #{i + 1}
              </h4>
              <p className="text-sm">
                All personnel entering the site must
                wear appropriate PPE including helmets
                and safety shoes.
              </p>
            </div>
          ))}

          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-300 text-sm font-bold text-center mt-8">
            *** End of Document ***
          </div>
        </div>

        <button
          disabled={!hasReadManual}
          onClick={() => setStep('EXAM')}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl disabled:opacity-50 shadow-lg transition-all"
        >
          {t('exam.start')}
        </button>
      </div>
    );
  }

  /* ================= RESULT STEP ================= */

  if (step === 'RESULT') {
    return (
      <div className="max-w-md mx-auto text-center p-10 bg-white dark:bg-slate-950 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 mt-10 transition-colors">

        {passed ? (
          <CheckCircle2 className="w-24 h-24 text-emerald-500 mx-auto mb-6" />
        ) : (
          <AlertCircle className="w-24 h-24 text-red-500 mx-auto mb-6" />
        )}

        <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-2">
          {passed ? t('exam.pass') : t('exam.fail')}
        </h2>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-6 my-6 border border-slate-200 dark:border-slate-800 transition-colors">
          <p className="text-slate-500 text-xs uppercase mb-2">
            Total Score
          </p>
          <p className="text-4xl font-black text-slate-800 dark:text-white">
            {score} / {questions.length}
          </p>
        </div>
      </div>
    );
  }

  /* ================= EXAM STEP ================= */

  const answeredCount = Object.keys(answers).length;
  const totalQuestions = questions.length;
  const progressPercent =
    totalQuestions === 0
      ? 0
      : Math.round(
          (answeredCount / totalQuestions) * 100
        );

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white dark:bg-slate-950 rounded-3xl shadow-lg border border-slate-200 dark:border-slate-800 transition-colors">

      <div className="sticky top-0 bg-white dark:bg-slate-950 pb-6 mb-8 border-b border-slate-200 dark:border-slate-800 z-20 transition-colors">

        <div className="flex justify-between mb-2">
          <h2 className="text-lg font-black text-slate-900 dark:text-white">
            Examination : {type}
          </h2>
          <span className="text-xs text-slate-500">
            {answeredCount}/{totalQuestions}
          </span>
        </div>

        <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              progressPercent === 100
                ? 'bg-emerald-500'
                : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="space-y-10">
        {questions.map((q, idx) => (
          <div key={q.id}>
            <p className="font-bold text-slate-900 dark:text-white mb-4 text-lg">
              <span className="text-slate-400 mr-2">
                {idx + 1}.
              </span>
              {language === 'th'
                ? q.content_th
                : q.content_en}
            </p>

            <div className="space-y-3 pl-6">
              {q.choices_json.map((c, cIdx) => (
                <label
                  key={cIdx}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    answers[q.id] === cIdx
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    checked={
                      answers[q.id] === cIdx
                    }
                    onChange={() =>
                      setAnswers({
                        ...answers,
                        [q.id]: cIdx
                      })
                    }
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    {language === 'th'
                      ? c.text_th
                      : c.text_en}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <button
          onClick={handleSubmit}
          disabled={
            loading ||
            answeredCount !== totalQuestions
          }
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            t('exam.submit')
          )}
        </button>
      </div>
    </div>
  );
};

export default ExamSystem;
