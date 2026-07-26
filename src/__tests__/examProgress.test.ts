import { describe, expect, it } from 'vitest';
import { ExamType } from '../types';
import {
  countAnsweredQuestions,
  getExamStepIndex,
  getExamSubmitDisabledReason,
  isSavedExamProgressValid,
} from '../services/examProgress';

const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] as any[];

describe('exam progress', () => {
  it('counts only complete answers from current questions', () => {
    expect(countAnsweredQuestions(questions, { q1: 0, q2: '', q3: [1, -1], old: 2 })).toBe(1);
    expect(countAnsweredQuestions(questions, { q1: 0, q2: 'คำตอบ', q3: [1, 0] })).toBe(3);
  });

  it('validates saved progress and rejects expired data', () => {
    const now = 2_000_000_000;
    const saved = { questions, answers: { q1: 0 }, step: 'EXAM', permitNo: '', hasReadManual: true, currentPage: 0, timestamp: now - 1_000 };
    expect(isSavedExamProgressValid(saved, now)).toBe(true);
    expect(isSavedExamProgressValid({ ...saved, timestamp: now - 25 * 60 * 60 * 1000 }, now)).toBe(false);
    expect(isSavedExamProgressValid({ ...saved, step: 'RESULT' }, now)).toBe(false);
  });

  it('returns actionable submit reasons in priority order', () => {
    expect(getExamSubmitDisabledReason({ loading: false, answeredCount: 1, totalQuestions: 3, type: ExamType.INDUCTION, permitNo: '' })).toContain('2 ข้อ');
    expect(getExamSubmitDisabledReason({ loading: false, answeredCount: 3, totalQuestions: 3, type: ExamType.WORK_PERMIT, permitNo: '123' })).toContain('10 หลัก');
    expect(getExamSubmitDisabledReason({ loading: false, answeredCount: 3, totalQuestions: 3, type: ExamType.SUPPLIER_OUTSOURCE, permitNo: '' })).toBeNull();
  });

  it('maps the three exam steps', () => {
    expect(['READ', 'EXAM', 'RESULT'].map((step) => getExamStepIndex(step as any))).toEqual([0, 1, 2]);
  });
});
