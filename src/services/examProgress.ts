import { ExamType, Question } from '../types';

export type ExamProgressStep = 'READ' | 'EXAM' | 'RESULT';

export interface SavedExamProgress {
  questions: Question[];
  answers: Record<string, unknown>;
  step: ExamProgressStep;
  permitNo: string;
  hasReadManual: boolean;
  currentPage: number;
  timestamp: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const isSavedExamProgressValid = (
  value: unknown,
  now = Date.now(),
  maxAgeMs = DAY_IN_MS,
): value is SavedExamProgress => {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<SavedExamProgress>;
  return Array.isArray(saved.questions)
    && saved.questions.length > 0
    && Boolean(saved.answers && typeof saved.answers === 'object')
    && (saved.step === 'READ' || saved.step === 'EXAM')
    && typeof saved.timestamp === 'number'
    && saved.timestamp <= now
    && now - saved.timestamp < maxAgeMs;
};

export const countAnsweredQuestions = (
  questions: Pick<Question, 'id'>[],
  answers: Record<string, unknown>,
) => questions.reduce((count, question) => {
  const answer = answers[question.id];
  if (answer === undefined || answer === null || answer === '') return count;
  if (Array.isArray(answer) && answer.some((item) => item === -1 || item === '' || item === null || item === undefined)) return count;
  return count + 1;
}, 0);

interface SubmitDisabledReasonInput {
  loading: boolean;
  answeredCount: number;
  totalQuestions: number;
  type: ExamType;
  permitNo: string;
}

export const getExamSubmitDisabledReason = ({
  loading,
  answeredCount,
  totalQuestions,
  type,
  permitNo,
}: SubmitDisabledReasonInput): string | null => {
  if (loading) return 'กำลังบันทึกผลสอบ กรุณารอสักครู่';
  if (totalQuestions === 0) return 'ยังไม่มีข้อสอบที่พร้อมใช้งาน';
  if (answeredCount < totalQuestions) return `กรุณาตอบคำถามให้ครบอีก ${totalQuestions - answeredCount} ข้อ`;
  if (type === ExamType.WORK_PERMIT && permitNo.length !== 10) return 'กรุณากรอกเลขใบอนุญาตให้ครบ 10 หลัก';
  return null;
};

export const getExamStepIndex = (step: ExamProgressStep) => ({ READ: 0, EXAM: 1, RESULT: 2 }[step]);
