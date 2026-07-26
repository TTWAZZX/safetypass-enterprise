import React from 'react';
import { Check } from 'lucide-react';

export interface ProgressStep {
  label: string;
  description?: string;
}

interface ProgressStepsProps {
  steps: ProgressStep[];
  currentStep: number;
  className?: string;
}

const ProgressSteps: React.FC<ProgressStepsProps> = ({ steps, currentStep, className = '' }) => (
  <nav aria-label="ความคืบหน้า" className={`w-full ${className}`}>
    <ol className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-2">
      {steps.map((step, index) => {
        const completed = index < currentStep;
        const active = index === currentStep;
        return (
          <li key={step.label} aria-current={active ? 'step' : undefined} className="relative min-w-0 text-center">
            <div className="flex items-center justify-center">
              {index > 0 && <span aria-hidden="true" className={`absolute right-1/2 top-[17px] h-0.5 w-full ${completed || active ? 'bg-blue-300' : 'bg-slate-200'}`} />}
              <span className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-[10px] font-black ${completed ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-400'}`}>
                {completed ? <Check size={15} aria-hidden="true" /> : index + 1}
              </span>
            </div>
            <p className={`mt-1 truncate text-[9px] font-black ${active ? 'text-blue-700' : completed ? 'text-emerald-700' : 'text-slate-400'}`}>{step.label}</p>
            {step.description && <p className="hidden truncate text-[8px] font-bold text-slate-400 sm:block">{step.description}</p>}
          </li>
        );
      })}
    </ol>
  </nav>
);

export default ProgressSteps;
