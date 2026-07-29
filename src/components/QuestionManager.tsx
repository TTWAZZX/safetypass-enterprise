import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import { ExamType, Question, QuestionPattern, QuestionRevision } from '../types';
import { readFirstWorksheetRows } from '../services/excelImport';
import { 
  Plus, Save, Trash2, BookOpen, Ticket, Loader2, 
  Edit3, Upload, Download, X, Search, Image as ImageIcon,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle2,
  ListFilter, Hash, HelpCircle, ArrowRightLeft, ChevronDown, Copy, SlidersHorizontal,
  History, RotateCcw
} from 'lucide-react';
import AsyncState from './AsyncState';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useToastContext } from './ToastProvider';

const getQuestionCode = (id: string) => {
  const compactId = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
  return `Q-${(compactId.slice(-6) || '000000').toUpperCase()}`;
};

const getQuestionChoices = (question: any) => Array.isArray(question?.choices_json) ? question.choices_json : [];

const getCorrectChoiceIndex = (question: any) => {
  const choices = getQuestionChoices(question);
  if (Number.isInteger(question?.correct_choice_index) && question.correct_choice_index >= 0) {
    return question.correct_choice_index;
  }
  return choices.findIndex((choice: any) => choice?.is_correct);
};

const getChoiceText = (choice: any) => choice?.text_th || choice?.text_en || 'ไม่มีข้อความตัวเลือก';

const getAnswerSummary = (question: any) => {
  const choices = getQuestionChoices(question);
  if (question.pattern === QuestionPattern.SHORT_ANSWER) {
    return choices[0]?.correct_answer || 'ยังไม่ได้ระบุเฉลย';
  }
  if (question.pattern === QuestionPattern.MATCHING) {
    return choices.length > 0 ? `${choices.length} คู่คำตอบ` : 'ยังไม่ได้ระบุคู่คำตอบ';
  }
  const correctIndex = getCorrectChoiceIndex(question);
  const correctChoice = choices[correctIndex];
  const correctText = correctChoice?.text_th || correctChoice?.text_en;
  return correctText ? `ตัวเลือก ${correctIndex + 1} — ${correctText}` : 'ยังไม่ได้ระบุเฉลย';
};

const getQuestionQualityIssues = (question: any) => {
  const issues: string[] = [];
  const pattern = question.pattern || QuestionPattern.MULTIPLE_CHOICE;
  const choices = getQuestionChoices(question);

  if (!String(question.content_th || '').trim()) issues.push('ไม่มีคำถามภาษาไทย');
  if (!String(question.content_en || '').trim()) issues.push('ไม่มีคำถามภาษาอังกฤษ');

  if (pattern === QuestionPattern.SHORT_ANSWER) {
    if (!String(choices[0]?.correct_answer || '').trim()) issues.push('ยังไม่ได้ระบุเฉลย');
    return issues;
  }

  if (pattern === QuestionPattern.MATCHING) {
    if (choices.length === 0) issues.push('ยังไม่มีคู่จับคู่');
    choices.forEach((pair: any, index: number) => {
      const fields = [
        pair?.left_th || pair?.left_text_th,
        pair?.left_en || pair?.left_text_en,
        pair?.right_th || pair?.right_text_th,
        pair?.right_en || pair?.right_text_en,
      ];
      if (fields.some((value) => !String(value || '').trim())) issues.push(`คู่จับคู่ ${index + 1} มีข้อมูลไม่ครบ`);
    });
    return issues;
  }

  const expectedChoices = pattern === QuestionPattern.TRUE_FALSE ? 2 : 4;
  if (choices.length < expectedChoices) issues.push(`มีตัวเลือก ${choices.length}/${expectedChoices}`);
  choices.slice(0, expectedChoices).forEach((choice: any, index: number) => {
    if (!String(choice?.text_th || '').trim()) issues.push(`ตัวเลือก ${index + 1} ไม่มีภาษาไทย`);
    if (!String(choice?.text_en || '').trim()) issues.push(`ตัวเลือก ${index + 1} ไม่มีภาษาอังกฤษ`);
  });
  const correctIndex = getCorrectChoiceIndex(question);
  if (correctIndex < 0 || correctIndex >= choices.length) issues.push('ยังไม่ได้กำหนดคำตอบที่ถูกต้อง');
  return issues;
};

const normalizeQuestionText = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s*\((สำเนา|copy)\)\s*$/i, '')
  .replace(/[?？!！.。,，:;:'"“”‘’()[\]{}]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const getDuplicateQuestionMap = (questions: any[]) => {
  const idsByText = new Map<string, Set<string>>();
  questions.forEach((question) => {
    const normalizedTexts = new Set([
      normalizeQuestionText(question.content_th),
      normalizeQuestionText(question.content_en),
    ]);
    normalizedTexts.forEach((text) => {
      if (text.length < 12) return;
      if (!idsByText.has(text)) idsByText.set(text, new Set());
      idsByText.get(text)?.add(question.id);
    });
  });

  const duplicates = new Map<string, Set<string>>();
  idsByText.forEach((ids) => {
    if (ids.size < 2) return;
    ids.forEach((id) => {
      if (!duplicates.has(id)) duplicates.set(id, new Set());
      ids.forEach((relatedId) => { if (relatedId !== id) duplicates.get(id)?.add(relatedId); });
    });
  });
  return new Map(Array.from(duplicates.entries(), ([id, relatedIds]) => [id, Array.from(relatedIds)]));
};

type PatternFilter = 'ALL' | QuestionPattern;
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type QualityFilter = 'ALL' | 'COMPLETE' | 'INCOMPLETE' | 'DUPLICATE';

const revisionActionLabels: Record<QuestionRevision['change_type'], string> = {
  BASELINE: 'ข้อมูลตั้งต้น',
  CREATE: 'สร้างคำถาม',
  SAVE: 'บันทึกการแก้ไข',
  PUBLISH: 'เผยแพร่',
  UNPUBLISH: 'เปลี่ยนเป็นฉบับร่าง',
  RESTORE: 'กู้คืนข้อมูล',
};

const PortalWhen: React.FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => {
  if (active && typeof document !== 'undefined') return createPortal(children, document.body);
  return <>{children}</>;
};

const QuestionManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [patternFilter, setPatternFilter] = useState<PatternFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const [examType, setExamType] = useState<ExamType>(ExamType.INDUCTION);
  const [pattern, setPattern] = useState<QuestionPattern>(QuestionPattern.MULTIPLE_CHOICE);
  const [th, setTh] = useState('');
  const [en, setEn] = useState('');
  
  // State สำหรับ Choice / True-False
  const [choices, setChoices] = useState([
    { text_th: '', text_en: '', is_correct: true },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
  ]);

  const [shortAnswer, setShortAnswer] = useState(''); 
  const [matchingPairs, setMatchingPairs] = useState([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingIsActive, setEditingIsActive] = useState(true);
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [lastSavedQuestion, setLastSavedQuestion] = useState<{ id: string; savedAt: Date } | null>(null);
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<string | null>(null);
  const [expandedAnswerIds, setExpandedAnswerIds] = useState<Set<string>>(() => new Set());
  const [revisionQuestion, setRevisionQuestion] = useState<any | null>(null);
  const [questionRevisions, setQuestionRevisions] = useState<QuestionRevision[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState('');
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);

  const questionQualityMap = useMemo(() => new Map(
    questions.map((question) => [question.id, getQuestionQualityIssues(question)]),
  ), [questions]);
  const duplicateQuestionMap = useMemo(() => getDuplicateQuestionMap(questions), [questions]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editDialogRef = useRef<HTMLElement>(null);
  const historyDialogRef = useRef<HTMLElement>(null);
  const questionCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (!highlightedQuestionId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = questionCardRefs.current.get(highlightedQuestionId);
      if (!card) return;
      const rect = card.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedQuestionId, currentPage, questions]);

  useEffect(() => {
    if (!editingId && !revisionQuestion) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editingId, revisionQuestion]);

  const fetchQuestions = async (options: { showLoading?: boolean; resetPage?: boolean } = {}) => {
    const { showLoading = true, resetPage = true } = options;
    if (showLoading) setLoading(true);
    setLoadError('');
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('type', examType) 
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Sanitize Data
      const sanitized = (data || []).map(q => ({
        ...q,
        pattern: q.pattern || QuestionPattern.MULTIPLE_CHOICE
      }));

      setQuestions(sanitized);
      if (resetPage) setCurrentPage(1);
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setLoadError(err?.message || 'ไม่สามารถโหลดคลังข้อสอบได้');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [examType]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, patternFilter, statusFilter, qualityFilter]);

  // ================= [ HANDLERS ] =================
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      if (editingId) setIsEditorDirty(true);
    }
  };

  const clearImage = (markDirty = true) => {
    setImageFile(null);
    setPreviewUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (markDirty && editingId) setIsEditorDirty(true);
  };

  const uploadImageToSupabase = async (): Promise<string | null> => {
    if (!imageFile) return previewUrl; 
    setUploadingImage(true);
    try {
      const filePath = `${Date.now()}.${imageFile.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('question-images').upload(filePath, imageFile);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('question-images').getPublicUrl(filePath);
      return data.publicUrl;
    } catch (error) { return null; } finally { setUploadingImage(false); }
  };

  const handleEdit = (q: any) => {
    setEditingId(q.id);
    setEditingIsActive(q.is_active ?? true);
    setExamType(q.type as ExamType);
    const qPattern = q.pattern || QuestionPattern.MULTIPLE_CHOICE;
    setPattern(qPattern as QuestionPattern);
    setTh(q.content_th);
    setEn(q.content_en);
    setPreviewUrl(q.image_url);
    setImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = '';

    setShortAnswer('');
    setMatchingPairs([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
    setChoices([
      { text_th: '', text_en: '', is_correct: true },
      { text_th: '', text_en: '', is_correct: false },
      { text_th: '', text_en: '', is_correct: false },
      { text_th: '', text_en: '', is_correct: false },
    ]);

    if (qPattern === QuestionPattern.SHORT_ANSWER) {
        setShortAnswer(q.choices_json?.[0]?.correct_answer || '');
    } else if (qPattern === QuestionPattern.MATCHING) {
        setMatchingPairs(q.choices_json || []);
    } else {
        const loadedChoices = q.choices_json || [];
        const fullChoices = [0,1,2,3].map(i => ({
            text_th: loadedChoices[i]?.text_th || '',
            text_en: loadedChoices[i]?.text_en || '',
            is_correct: q.correct_choice_index !== undefined ? q.correct_choice_index === i : (loadedChoices[i]?.is_correct || false)
        }));
        setChoices(fullChoices);
    }
    setIsEditorDirty(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingIsActive(true);
    setPattern(QuestionPattern.MULTIPLE_CHOICE);
    setTh(''); setEn(''); setShortAnswer('');
    setMatchingPairs([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
    setChoices([{ text_th: '', text_en: '', is_correct: true }, { text_th: '', text_en: '', is_correct: false }, { text_th: '', text_en: '', is_correct: false }, { text_th: '', text_en: '', is_correct: false }]);
    clearImage(false);
    setIsEditorDirty(false);
  };

  const requestCloseEditor = () => {
    if (isEditorDirty && !window.confirm('มีข้อมูลที่แก้ไขแต่ยังไม่ได้บันทึก ต้องการปิดหน้าต่างนี้หรือไม่?')) return;
    handleCancelEdit();
  };

  const getNavigableQuestions = () => {
    const keyword = searchTerm.trim().toLowerCase();
    return questions.filter((question) => {
      const matchesKeyword = !keyword
        || String(question.content_th || '').toLowerCase().includes(keyword)
        || String(question.content_en || '').toLowerCase().includes(keyword)
        || getQuestionCode(question.id).toLowerCase().includes(keyword);
      const matchesPattern = patternFilter === 'ALL' || question.pattern === patternFilter;
      const matchesStatus = statusFilter === 'ALL'
        || (statusFilter === 'ACTIVE' ? question.is_active === true : question.is_active !== true);
      const issues = questionQualityMap.get(question.id) || [];
      const matchesQuality = qualityFilter === 'ALL'
        || (qualityFilter === 'COMPLETE' && issues.length === 0)
        || (qualityFilter === 'INCOMPLETE' && issues.length > 0)
        || (qualityFilter === 'DUPLICATE' && duplicateQuestionMap.has(question.id));
      return matchesKeyword && matchesPattern && matchesStatus && matchesQuality;
    });
  };

  const resetQuestionFilters = () => {
    setSearchTerm('');
    setPatternFilter('ALL');
    setStatusFilter('ALL');
    setQualityFilter('ALL');
  };

  const getAdjacentQuestion = (direction: -1 | 1) => {
    const navigable = getNavigableQuestions();
    const currentIndex = navigable.findIndex((question) => question.id === editingId);
    if (currentIndex < 0) return null;
    return navigable[currentIndex + direction] || null;
  };

  const openQuestionInEditor = (question: any) => {
    const navigable = getNavigableQuestions();
    const targetIndex = navigable.findIndex((item) => item.id === question.id);
    if (targetIndex >= 0) setCurrentPage(Math.floor(targetIndex / itemsPerPage) + 1);
    handleEdit(question);
    window.requestAnimationFrame(() => editDialogRef.current?.scrollTo({ top: 0, behavior: 'auto' }));
  };

  const handleNavigateQuestion = (direction: -1 | 1) => {
    const target = getAdjacentQuestion(direction);
    if (!target) return;
    if (isEditorDirty && !window.confirm('มีข้อมูลที่แก้ไขแต่ยังไม่ได้บันทึก ต้องการไปยังคำถามอื่นหรือไม่?')) return;
    openQuestionInEditor(target);
  };

  const markQuestionSaved = (id: string) => {
    setLastSavedQuestion({ id, savedAt: new Date() });
    setHighlightedQuestionId(id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedQuestionId(null), 5000);
  };

  const loadQuestionRevisions = async (questionId: string) => {
    setRevisionLoading(true);
    setRevisionError('');
    try {
      const revisions = await api.getQuestionRevisions(questionId);
      setQuestionRevisions(revisions);
    } catch (error: any) {
      setRevisionError(error?.message || 'ไม่สามารถโหลดประวัติคำถามได้');
    } finally {
      setRevisionLoading(false);
    }
  };

  const handleOpenRevisionHistory = (question: any) => {
    setRevisionQuestion(question);
    setQuestionRevisions([]);
    loadQuestionRevisions(question.id);
  };

  const closeRevisionHistory = () => {
    if (restoringRevisionId) return;
    setRevisionQuestion(null);
    setQuestionRevisions([]);
    setRevisionError('');
  };

  const handleRestoreRevision = async (revision: QuestionRevision) => {
    if (!revisionQuestion || revision.is_current) return;
    const questionCode = getQuestionCode(revisionQuestion.id);
    if (!window.confirm(`กู้คืน ${questionCode} กลับเป็นรุ่นที่ ${revision.revision_no} หรือไม่?\nเนื้อหา เฉลย รูปภาพ และสถานะเผยแพร่จะกลับไปตามรุ่นนี้`)) return;

    setRestoringRevisionId(revision.id);
    try {
      await api.restoreQuestionRevision(revisionQuestion.id, revision.id);
      setRevisionQuestion((current: any) => current ? { ...current, ...revision.snapshot, id: current.id } : current);
      await fetchQuestions({ showLoading: false, resetPage: false });
      await loadQuestionRevisions(revisionQuestion.id);
      markQuestionSaved(revisionQuestion.id);
      showToast(`กู้คืน ${questionCode} เป็นรุ่นที่ ${revision.revision_no} สำเร็จ`, 'success');
    } catch (error: any) {
      showToast(`กู้คืนข้อมูลไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setRestoringRevisionId(null);
    }
  };

  useDialogFocus(Boolean(editingId), editDialogRef, requestCloseEditor);
  useDialogFocus(Boolean(revisionQuestion), historyDialogRef, closeRevisionHistory);

  const handleSave = async (mode: 'close' | 'next' = 'close') => {
    if(!th || !en) return alert("กรุณากรอกโจทย์");
    let finalChoices: any[] = choices;
    let correctIndex = choices.findIndex(c => c.is_correct);

    if (pattern === QuestionPattern.SHORT_ANSWER) {
        finalChoices = [{ correct_answer: shortAnswer }];
        correctIndex = 0;
    } else if (pattern === QuestionPattern.MATCHING) {
        finalChoices = matchingPairs;
        correctIndex = 0;
    } else if (pattern === QuestionPattern.TRUE_FALSE) {
        // ✅ CLEAN DATA: กรองเอาเฉพาะตัวเลือกที่มีข้อความเท่านั้น เพื่อไม่ให้บันทึกช่องว่างลงไป
        finalChoices = choices.filter(c => c.text_th.trim() !== '' || c.text_en.trim() !== '');
        
        // ถ้ากรองแล้วเหลือ 0 ให้บังคับเอา 2 ช่องแรก (กัน Error)
        if (finalChoices.length === 0) finalChoices = choices.slice(0, 2);
        
        // Reset correctIndex ถ้ามันชี้ไปผิดที่
        const newCorrectIndex = finalChoices.findIndex(c => c.is_correct);
        correctIndex = newCorrectIndex !== -1 ? newCorrectIndex : 0;
        
        // Ensure only one is correct
        finalChoices = finalChoices.map((c, idx) => ({ ...c, is_correct: idx === correctIndex }));
    }

    const nextQuestion = mode === 'next' && editingId ? getAdjacentQuestion(1) : null;
    setIsSaving(true);
    try {
      const imageUrl = await uploadImageToSupabase();
      const payload: Partial<Question> = {
          type: examType,
          pattern: pattern,
          content_th: th,
          content_en: en,
          choices_json: finalChoices,
          correct_choice_index: correctIndex,
          image_url: imageUrl,
          is_active: editingIsActive
      };
      const wasEditing = Boolean(editingId);
      const savedId = editingId
        ? await api.updateQuestion(editingId, payload)
        : await api.createQuestion(payload);
      if (!wasEditing) setCurrentPage(1);
      await fetchQuestions({ showLoading: false, resetPage: !wasEditing });
      markQuestionSaved(savedId);
      if (nextQuestion) {
        openQuestionInEditor(nextQuestion);
        showToast(`บันทึก ${getQuestionCode(savedId)} แล้ว กำลังเปิด ${getQuestionCode(nextQuestion.id)}`, 'success');
      } else {
        handleCancelEdit();
        showToast(`บันทึกคำถาม ${getQuestionCode(savedId)} สำเร็จ`, 'success');
      }
    } catch (err: any) {
      showToast(`บันทึกคำถามไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = async (question: any) => {
    const sourceCode = getQuestionCode(question.id);
    if (!window.confirm(`สร้างสำเนาคำถาม ${sourceCode} หรือไม่?\nสำเนาจะถูกปิดใช้งานไว้จนกว่าจะตรวจสอบเรียบร้อย`)) return;

    const duplicatePayload: Partial<Question> = {
      type: question.type,
      pattern: question.pattern || QuestionPattern.MULTIPLE_CHOICE,
      content_th: `${question.content_th} (สำเนา)`,
      content_en: `${question.content_en} (Copy)`,
      choices_json: JSON.parse(JSON.stringify(getQuestionChoices(question))),
      correct_choice_index: Math.max(0, getCorrectChoiceIndex(question)),
      image_url: question.image_url || null,
      is_active: false,
    };

    setDuplicatingId(question.id);
    try {
      const duplicateId = await api.createQuestion(duplicatePayload);
      const duplicateQuestion = { ...question, ...duplicatePayload, id: duplicateId, is_active: false };
      await fetchQuestions({ showLoading: false, resetPage: true });
      setCurrentPage(1);
      markQuestionSaved(duplicateId);
      handleEdit(duplicateQuestion);
      showToast(`สร้างสำเนา ${getQuestionCode(duplicateId)} แล้ว และปิดใช้งานไว้เพื่อรอตรวจสอบ`, 'success');
    } catch (error: any) {
      showToast(`สร้างสำเนาไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("ต้องการลบข้อสอบนี้ใช่หรือไม่?")) return;
    await api.deleteQuestion(id);
    fetchQuestions();
  };

  const handleToggleActive = async (question: any) => {
    const willPublish = question.is_active !== true;
    const actionText = willPublish ? 'เผยแพร่คำถามนี้เข้าสู่ชุดข้อสอบ' : 'เปลี่ยนคำถามนี้กลับเป็นฉบับร่าง';
    if (!window.confirm(`${actionText} หรือไม่?`)) return;
    setPublishingId(question.id);
    try {
      const savedId = await api.updateQuestion(question.id, { ...question, is_active: willPublish });
      await fetchQuestions({ showLoading: false, resetPage: false });
      markQuestionSaved(savedId);
      showToast(`${willPublish ? 'เผยแพร่' : 'บันทึกเป็นฉบับร่าง'} ${getQuestionCode(question.id)} สำเร็จ`, 'success');
    } catch (error: any) {
      showToast(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleQuestionImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const rows = await readFirstWorksheetRows(file);
      let imported = 0;
      for (const row of rows) {
        const value = (names: string[]) => {
          const key = Object.keys(row).find((item) => names.includes(item.trim().toLowerCase()));
          return key ? String(row[key] ?? '').trim() : '';
        };
        const contentTh = value(['question th', 'question_th', 'คำถามภาษาไทย', 'คำถาม']);
        const contentEn = value(['question en', 'question_en', 'คำถามภาษาอังกฤษ']);
        if (!contentTh || !contentEn) continue;
        const importedPattern = (value(['pattern', 'รูปแบบ']) || 'MULTIPLE_CHOICE').toUpperCase() as QuestionPattern;
        const importedType = (value(['type', 'exam type', 'ประเภทข้อสอบ']) || examType).toUpperCase();
        const publicationStatus = value(['status', 'publication status', 'is_active', 'สถานะ']).toLowerCase();
        const importedIsActive = !['draft', 'inactive', 'off', 'false', '0', 'ฉบับร่าง'].includes(publicationStatus);
        const correct = Math.max(0, Number(value(['correct choice', 'correct_choice_index', 'คำตอบที่ถูก'])) - 1 || 0);
        const importedChoices = [1, 2, 3, 4].map((index) => ({
          text_th: value([`choice ${index} th`, `choice_${index}_th`, `ตัวเลือก ${index} ไทย`]),
          text_en: value([`choice ${index} en`, `choice_${index}_en`, `ตัวเลือก ${index} อังกฤษ`]),
          is_correct: index - 1 === correct,
        })).filter((choice) => choice.text_th || choice.text_en);
        await api.createQuestion({
          type: importedType as any,
          pattern: importedPattern,
          content_th: contentTh,
          content_en: contentEn,
          choices_json: importedPattern === QuestionPattern.SHORT_ANSWER
            ? [{ correct_answer: value(['correct answer', 'คำตอบ']) }]
            : importedChoices,
          correct_choice_index: correct,
          image_url: null,
          is_active: importedIsActive,
        });
        imported++;
      }
      alert(`นำเข้าข้อสอบสำเร็จ ${imported} ข้อ`);
      fetchQuestions();
    } catch (error: any) {
      alert('นำเข้าไม่สำเร็จ: ' + error.message);
    }
  };

  // ================= [ RENDER ] =================
  const filteredQuestions = getNavigableQuestions();
  const totalPages = Math.ceil(filteredQuestions.length / itemsPerPage);
  const currentQuestions = filteredQuestions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const editingQuestionIndex = filteredQuestions.findIndex((question) => question.id === editingId);
  const hasPreviousQuestion = editingQuestionIndex > 0;
  const hasNextQuestion = editingQuestionIndex >= 0 && editingQuestionIndex < filteredQuestions.length - 1;
  const editingQuestionCode = editingId ? getQuestionCode(editingId) : '';
  const incompleteQuestionCount = questions.filter((question) => (questionQualityMap.get(question.id) || []).length > 0).length;
  const completeQuestionCount = questions.length - incompleteQuestionCount;
  const duplicateQuestionCount = duplicateQuestionMap.size;
  const activeAdvancedFilterCount = [patternFilter, statusFilter, qualityFilter].filter((value) => value !== 'ALL').length;
  const hasQuestionFilters = Boolean(searchTerm.trim()) || activeAdvancedFilterCount > 0;

  return (
    <div className="space-y-8 pb-10 text-left">
      
      {/* 🟢 Form Section — edit mode reuses the same form inside an accessible modal. */}
      <PortalWhen active={Boolean(editingId)}>
      <div
        className={editingId ? 'fixed inset-0 z-[9998] flex items-stretch justify-center overflow-hidden bg-slate-950/70 p-2 backdrop-blur-sm sm:items-center sm:p-4' : ''}
        onMouseDown={(event) => { if (editingId && event.target === event.currentTarget) requestCloseEditor(); }}
      >
      <section
        id={editingId ? 'question-edit-dialog' : undefined}
        ref={editDialogRef}
        role={editingId ? 'dialog' : undefined}
        aria-modal={editingId ? true : undefined}
        aria-labelledby={editingId ? 'question-editor-title' : undefined}
        tabIndex={editingId ? -1 : undefined}
        className={`rounded-[2rem] border-2 p-6 transition-all focus:outline-none md:p-8 ${editingId ? 'h-[calc(100dvh-1rem)] w-full max-w-6xl overflow-y-auto overscroll-contain border-amber-200 bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)]' : 'border-slate-100 bg-white shadow-sm'}`}
        onMouseDown={(event) => event.stopPropagation()}
        onChangeCapture={() => { if (editingId) setIsEditorDirty(true); }}
      >
        <div className={`${editingId ? 'sticky top-0 z-30 -mx-3 -mt-3 mb-5 border-b border-slate-100 bg-white/95 px-3 py-3 backdrop-blur md:-mx-4 md:-mt-4 md:px-4 md:py-4' : 'mb-6'} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${editingId ? 'bg-amber-100 text-amber-800' : 'bg-blue-600 text-white'}`}>{editingId ? <Edit3 size={20} /> : <Plus size={20} />}</div>
            <div>
              <h3 id="question-editor-title" className="text-lg font-black text-slate-900 uppercase leading-none">{editingId ? 'Edit Question' : 'Create Question'}</h3>
              {editingId && <p className="mt-1 text-[9px] font-black text-slate-600">{editingQuestionCode}{isEditorDirty ? ' • มีการแก้ไขที่ยังไม่บันทึก' : ''}</p>}
            </div>
          </div>
          {editingId && <button onClick={requestCloseEditor} aria-label="ปิดหน้าต่างแก้ไขคำถาม" className="min-h-11 min-w-11 p-2 bg-white text-slate-600 hover:text-red-700 rounded-full border border-slate-200"><X size={18}/></button>}
        </div>

        {editingId && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => handleNavigateQuestion(-1)}
              disabled={!hasPreviousQuestion || isSaving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={16}/> ข้อก่อนหน้า
            </button>
            <div className="text-center">
              <p className="text-[10px] font-black text-slate-800">{editingQuestionIndex >= 0 ? `ข้อ ${editingQuestionIndex + 1} จาก ${filteredQuestions.length}` : editingQuestionCode}</p>
              <p className="mt-0.5 text-[9px] text-slate-600">เลื่อนตามรายการและคำค้นหาปัจจุบัน</p>
            </div>
            <button
              type="button"
              onClick={() => handleNavigateQuestion(1)}
              disabled={!hasNextQuestion || isSaving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ข้อถัดไป <ChevronRight size={16}/>
            </button>
          </div>
        )}

        {editingId && !editingIsActive && (
          <div role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
            คำถามนี้ปิดใช้งานอยู่ สามารถแก้ไขและตรวจสอบได้โดยยังไม่ถูกนำไปสุ่มในข้อสอบ
          </div>
        )}

        <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-2xl mb-8 gap-1">
            <PatternTab active={pattern === QuestionPattern.MULTIPLE_CHOICE} onClick={() => { setPattern(QuestionPattern.MULTIPLE_CHOICE); if (editingId) setIsEditorDirty(true); }} icon={<ListFilter size={14}/>} label="Choice" />
            <PatternTab active={pattern === QuestionPattern.TRUE_FALSE} onClick={() => { setPattern(QuestionPattern.TRUE_FALSE); if (editingId) setIsEditorDirty(true); }} icon={<HelpCircle size={14}/>} label="T/F" />
            <PatternTab active={pattern === QuestionPattern.MATCHING} onClick={() => { setPattern(QuestionPattern.MATCHING); if (editingId) setIsEditorDirty(true); }} icon={<ArrowRightLeft size={14}/>} label="Matching" />
            <PatternTab active={pattern === QuestionPattern.SHORT_ANSWER} onClick={() => { setPattern(QuestionPattern.SHORT_ANSWER); if (editingId) setIsEditorDirty(true); }} icon={<Hash size={14}/>} label="Writing" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
                <div role="button" tabIndex={0} aria-label="เลือกรูปประกอบข้อสอบ" className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-5 text-center cursor-pointer relative overflow-hidden group hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500" onClick={() => imageInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); imageInputRef.current?.click(); } }}>
                    <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                    {previewUrl ? <div className="relative"><img src={previewUrl} alt="รูปประกอบข้อสอบ" className="h-44 mx-auto rounded-2xl object-contain shadow-lg bg-white" /><button onClick={(e) => { e.stopPropagation(); clearImage(); }} aria-label="ลบรูปประกอบข้อสอบ" className="absolute -top-2 -right-2 min-h-11 min-w-11 bg-red-700 text-white p-1 rounded-full border-2 border-white"><X size={14}/></button></div> : <div className="py-10 text-slate-600 flex flex-col items-center gap-2 group-hover:text-blue-700"><ImageIcon size={32}/><span className="text-[10px] font-black uppercase tracking-widest">Media Assets</span></div>}
                </div>
                <div className="space-y-2">
                    <label htmlFor="question-content-th" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Question (Thai)</label>
                    <input id="question-content-th" placeholder="โจทย์ภาษาไทย" value={th} onChange={e=>setTh(e.target.value)} className="w-full p-4 border border-slate-200 rounded-2xl text-base md:text-sm font-bold bg-white outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-2">
                    <label htmlFor="question-content-en" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Question (English)</label>
                    <input id="question-content-en" placeholder="Question in English" value={en} onChange={e=>setEn(e.target.value)} className="w-full p-4 border border-slate-200 rounded-2xl text-base md:text-sm font-bold bg-white outline-none focus:border-blue-500" />
                </div>
                <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                    <button onClick={() => { setExamType(ExamType.INDUCTION); if (editingId) setIsEditorDirty(true); }} className={`min-h-11 flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${examType === ExamType.INDUCTION ? 'bg-blue-700 text-white shadow-md' : 'text-slate-600 hover:text-slate-800'}`}>INDUCTION</button>
                    <button onClick={() => { setExamType(ExamType.WORK_PERMIT); if (editingId) setIsEditorDirty(true); }} className={`min-h-11 flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${examType === ExamType.WORK_PERMIT ? 'bg-purple-700 text-white shadow-md' : 'text-slate-600 hover:text-slate-800'}`}>WORK PERMIT</button>
                    <button onClick={() => { setExamType(ExamType.SUPPLIER_OUTSOURCE); if (editingId) setIsEditorDirty(true); }} className={`min-h-11 flex-1 py-3 rounded-xl font-black text-[9px] transition-all ${examType === ExamType.SUPPLIER_OUTSOURCE ? 'bg-emerald-700 text-white shadow-md' : 'text-slate-600 hover:text-slate-800'}`}>SUPPLIER & OUTSOURCE</button>
                </div>
                <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <legend className="px-2 text-[9px] font-black text-slate-700">สถานะคำถาม</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" aria-pressed={!editingIsActive} onClick={() => { setEditingIsActive(false); if (editingId) setIsEditorDirty(true); }} className={`min-h-11 rounded-xl border text-[10px] font-black ${!editingIsActive ? 'border-amber-300 bg-amber-100 text-amber-950' : 'border-slate-200 bg-white text-slate-700'}`}>ฉบับร่าง</button>
                    <button type="button" aria-pressed={editingIsActive} onClick={() => { setEditingIsActive(true); if (editingId) setIsEditorDirty(true); }} className={`min-h-11 rounded-xl border text-[10px] font-black ${editingIsActive ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}>เผยแพร่</button>
                  </div>
                  <p className="mt-2 text-[9px] text-slate-600">ฉบับร่างจะไม่ถูกนำไปสุ่มในข้อสอบจนกว่าจะเผยแพร่</p>
                </fieldset>
            </div>
            <div className="space-y-4">
                {(pattern === QuestionPattern.MULTIPLE_CHOICE || pattern === QuestionPattern.TRUE_FALSE) && (
                    <div className="space-y-2">
                        {/* ✅ UI: แสดงช่องกรอก 2 หรือ 4 ช่อง ตามประเภท */}
                        {(pattern === QuestionPattern.TRUE_FALSE ? choices.slice(0, 2) : choices).map((c, idx) => (
                            <div key={idx} className={`flex gap-3 items-center p-3 rounded-2xl border-2 transition-all ${c.is_correct ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 bg-slate-50'}`}>
                                <input type="radio" name="correct_choice" aria-label={`กำหนดตัวเลือก ${idx + 1} เป็นคำตอบที่ถูกต้อง`} checked={c.is_correct} onChange={() => { const n = choices.map(ch => ({ ...ch, is_correct: false })); n[idx].is_correct = true; setChoices(n); }} className="w-5 h-5 text-emerald-700 cursor-pointer" />
                                <div className="flex-1 space-y-1">
                                    <input placeholder="ตัวเลือก (ไทย)" value={c.text_th} onChange={e => { const n = [...choices]; n[idx].text_th = e.target.value; setChoices(n); }} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold outline-none" />
                                    <input placeholder="Choice (English)" value={c.text_en} onChange={e => { const n = [...choices]; n[idx].text_en = e.target.value; setChoices(n); }} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold outline-none" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {pattern === QuestionPattern.SHORT_ANSWER && <div className="p-6 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-center"><label htmlFor="question-short-answer" className="text-[9px] font-black text-slate-600 uppercase mb-2 block tracking-widest">Correct Answer</label><input id="question-short-answer" value={shortAnswer} onChange={e => setShortAnswer(e.target.value)} placeholder="เฉลย..." className="w-full p-4 border border-slate-200 rounded-2xl text-sm font-black text-blue-700 shadow-inner outline-none text-center" /></div>}
                {pattern === QuestionPattern.MATCHING && <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">{matchingPairs.map((pair, idx) => (<div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 relative"><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Left</span><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งซ้ายภาษาไทย`} value={pair.left_th} onChange={e => { const n = [...matchingPairs]; n[idx].left_th = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งซ้ายภาษาอังกฤษ`} value={pair.left_en} onChange={e => { const n = [...matchingPairs]; n[idx].left_en = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /></div><div className="space-y-1"><span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Right</span><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งขวาภาษาไทย`} value={pair.right_th} onChange={e => { const n = [...matchingPairs]; n[idx].right_th = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งขวาภาษาอังกฤษ`} value={pair.right_en} onChange={e => { const n = [...matchingPairs]; n[idx].right_en = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /></div></div>{matchingPairs.length > 1 && <button onClick={() => { setMatchingPairs(matchingPairs.filter((_, i) => i !== idx)); if (editingId) setIsEditorDirty(true); }} aria-label={`ลบคู่จับคู่ลำดับ ${idx + 1}`} className="absolute -top-1 -right-1 min-h-11 min-w-11 bg-red-100 text-red-700 p-1 rounded-full"><X size={10}/></button>}</div>))}<button onClick={() => { setMatchingPairs([...matchingPairs, { left_th: '', left_en: '', right_th: '', right_en: '' }]); if (editingId) setIsEditorDirty(true); }} className="min-h-11 w-full py-2 border-2 border-dashed border-slate-300 text-slate-600 text-[10px] font-black rounded-xl hover:bg-slate-50 uppercase tracking-widest">Add +</button></div>}
            </div>
        </div>
        <div className={`${editingId ? 'sticky bottom-0 z-20 -mx-3 mt-8 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur sm:flex-row' : 'mt-8'}`}>
          {editingId && (
            <button
              type="button"
              onClick={() => handleSave('next')}
              disabled={isSaving || uploadingImage || !hasNextQuestion}
              title={!hasNextQuestion ? 'คำถามนี้เป็นข้อสุดท้ายในรายการปัจจุบัน' : undefined}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-5 text-xs font-black text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} บันทึกและไปข้อถัดไป <ChevronRight size={16}/>
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave('close')}
            disabled={isSaving || uploadingImage}
            className={`${editingId ? 'flex-1' : 'w-full md:w-auto'} inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-8 text-xs font-black text-white shadow-xl hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isSaving || uploadingImage ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} {editingId ? 'บันทึกและปิด' : editingIsActive ? 'บันทึกและเผยแพร่' : 'บันทึกฉบับร่าง'}
          </button>
        </div>
      </section>
      </div>
      </PortalWhen>

      {revisionQuestion && (
        <PortalWhen active>
        <div
          className="fixed inset-0 z-[9998] flex items-stretch justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeRevisionHistory(); }}
        >
          <section
            ref={historyDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-history-title"
            tabIndex={-1}
            className="flex h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl focus:outline-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-[2rem]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-black text-blue-800">
                    <History size={13}/> ประวัติการแก้ไข
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black text-slate-700">
                    {getQuestionCode(revisionQuestion.id)}
                  </span>
                </div>
                <h3 id="question-history-title" className="text-lg font-black text-slate-950 sm:text-xl">ประวัติและการกู้คืนคำถาม</h3>
                <p className="mt-1 line-clamp-2 text-xs font-bold leading-relaxed text-slate-600">{revisionQuestion.content_th}</p>
              </div>
              <button
                type="button"
                onClick={closeRevisionHistory}
                disabled={Boolean(restoringRevisionId)}
                aria-label="ปิดประวัติคำถาม"
                className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={18}/>
              </button>
            </div>

            <div className="overflow-y-auto p-4 sm:p-6">
              {revisionLoading ? (
                <AsyncState compact variant="loading" title="กำลังโหลดประวัติคำถาม" />
              ) : revisionError ? (
                <AsyncState compact variant="error" title="โหลดประวัติคำถามไม่สำเร็จ" description={revisionError} onRetry={() => loadQuestionRevisions(revisionQuestion.id)} />
              ) : questionRevisions.length === 0 ? (
                <AsyncState compact variant="empty" title="ยังไม่มีประวัติการแก้ไข" description="เมื่อบันทึกหรือเปลี่ยนสถานะคำถาม ระบบจะแสดงแต่ละรุ่นไว้ที่นี่" />
              ) : (
                <ol className="space-y-3">
                  {questionRevisions.map((revision) => {
                    const snapshot = revision.snapshot || ({} as Question);
                    const isPublished = snapshot.is_active === true;
                    return (
                      <li key={revision.id} className={`rounded-2xl border p-4 ${revision.is_current ? 'border-blue-300 bg-blue-50/70 shadow-sm' : 'border-slate-200 bg-white'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-black text-slate-950">รุ่นที่ {revision.revision_no}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-700">
                                {revisionActionLabels[revision.change_type] || revision.change_type}
                              </span>
                              <span className={`rounded-full border px-2 py-1 text-[9px] font-black ${isPublished ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                                {isPublished ? 'เผยแพร่' : 'ฉบับร่าง'}
                              </span>
                              {revision.is_current && <span className="rounded-full bg-blue-700 px-2 py-1 text-[9px] font-black text-white">รุ่นปัจจุบัน</span>}
                            </div>
                            <p className="mt-2 text-[10px] font-bold text-slate-600">
                              {revision.changed_by_name || 'ผู้ดูแลระบบ'} • {new Date(revision.changed_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                            {revision.note && <p className="mt-1 text-[10px] font-bold text-slate-700">หมายเหตุ: {revision.note}</p>}
                          </div>
                          {!revision.is_current && (
                            <button
                              type="button"
                              onClick={() => handleRestoreRevision(revision)}
                              disabled={Boolean(restoringRevisionId)}
                              className="inline-flex min-h-11 flex-none items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-[10px] font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {restoringRevisionId === revision.id ? <Loader2 size={15} className="animate-spin"/> : <RotateCcw size={15}/>} กู้คืนรุ่นนี้
                            </button>
                          )}
                        </div>
                        <details className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <summary className="cursor-pointer text-[10px] font-black text-blue-800">ดูข้อมูลในรุ่นนี้</summary>
                          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                            <p className="text-xs font-black leading-relaxed text-slate-900">{snapshot.content_th || 'ไม่มีคำถามภาษาไทย'}</p>
                            <p className="text-[10px] font-bold italic leading-relaxed text-slate-600">{snapshot.content_en || 'ไม่มีคำถามภาษาอังกฤษ'}</p>
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-900">
                              เฉลย: {getAnswerSummary(snapshot)}
                            </div>
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
        </PortalWhen>
      )}

      {/* 🔵 Master Repository List */}
      <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-sm min-h-[500px]">
        <div className="flex flex-col md:flex-row justify-between items-center mb-5 gap-4">
            <div className="text-left">
              <h3 className="text-xl font-black text-slate-900 uppercase">Master Repository</h3>
              <div className="text-[10px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> แสดง {filteredQuestions.length} จาก {questions.length} คำถาม
              </div>
            </div>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <div className="relative min-w-[220px] flex-1"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input aria-label="ค้นหาคำถามหรือรหัสคำถาม" placeholder="ค้นหาคำถามหรือรหัส Q-..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-xs font-bold outline-none focus:border-blue-500" /></div>
                <button
                  type="button"
                  aria-expanded={showAdvancedFilters}
                  aria-controls="question-advanced-filters"
                  onClick={() => setShowAdvancedFilters((value) => !value)}
                  className={`relative flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2.5 text-[9px] font-black ${showAdvancedFilters || activeAdvancedFilterCount > 0 ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  <SlidersHorizontal size={16}/> ตัวกรอง
                  {activeAdvancedFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1 text-[8px] text-white">{activeAdvancedFilterCount}</span>}
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleQuestionImport} />
                <button onClick={() => fileInputRef.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[9px] font-black uppercase tracking-widest text-emerald-700"><Upload size={16}/> Import</button>
                <button onClick={() => fetchQuestions()} aria-label="รีเฟรชคลังข้อสอบ" className="min-h-11 min-w-11 p-2.5 bg-slate-50 text-slate-400 rounded-xl hover:text-blue-600 transition-all border border-slate-100 shadow-sm"><RefreshCw size={18}/></button>
            </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="สรุปคุณภาพคำถาม">
          <button type="button" aria-pressed={!hasQuestionFilters} onClick={resetQuestionFilters} className={`rounded-2xl border p-3 text-left ${!hasQuestionFilters ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
            <span className="text-[9px] font-black text-slate-600">ทั้งหมด</span><strong className="mt-1 block text-xl text-slate-900">{questions.length}</strong>
          </button>
          <button type="button" aria-pressed={qualityFilter === 'COMPLETE'} onClick={() => setQualityFilter('COMPLETE')} className={`rounded-2xl border p-3 text-left ${qualityFilter === 'COMPLETE' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            <span className="text-[9px] font-black text-emerald-800">ข้อมูลครบ</span><strong className="mt-1 block text-xl text-emerald-800">{completeQuestionCount}</strong>
          </button>
          <button type="button" aria-pressed={qualityFilter === 'INCOMPLETE'} onClick={() => setQualityFilter('INCOMPLETE')} className={`rounded-2xl border p-3 text-left ${qualityFilter === 'INCOMPLETE' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <span className="text-[9px] font-black text-amber-900">ข้อมูลไม่ครบ</span><strong className="mt-1 block text-xl text-amber-900">{incompleteQuestionCount}</strong>
          </button>
          <button type="button" aria-pressed={qualityFilter === 'DUPLICATE'} onClick={() => setQualityFilter('DUPLICATE')} className={`rounded-2xl border p-3 text-left ${qualityFilter === 'DUPLICATE' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <span className="text-[9px] font-black text-red-800">อาจซ้ำ</span><strong className="mt-1 block text-xl text-red-800">{duplicateQuestionCount}</strong>
          </button>
        </div>

        {showAdvancedFilters && (
          <div id="question-advanced-filters" className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 md:grid-cols-4">
            <div>
              <label htmlFor="question-pattern-filter" className="mb-1 block text-[9px] font-black text-slate-700">รูปแบบคำถาม</label>
              <select id="question-pattern-filter" value={patternFilter} onChange={(event) => setPatternFilter(event.target.value as PatternFilter)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800">
                <option value="ALL">ทุกรูปแบบ</option><option value={QuestionPattern.MULTIPLE_CHOICE}>ปรนัย</option><option value={QuestionPattern.TRUE_FALSE}>ถูก/ผิด</option><option value={QuestionPattern.MATCHING}>จับคู่</option><option value={QuestionPattern.SHORT_ANSWER}>เขียนตอบ</option>
              </select>
            </div>
            <div>
              <label htmlFor="question-status-filter" className="mb-1 block text-[9px] font-black text-slate-700">สถานะใช้งาน</label>
              <select id="question-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800">
                <option value="ALL">ทุกสถานะ</option><option value="ACTIVE">เผยแพร่</option><option value="INACTIVE">ฉบับร่าง</option>
              </select>
            </div>
            <div>
              <label htmlFor="question-quality-filter" className="mb-1 block text-[9px] font-black text-slate-700">คุณภาพข้อมูล</label>
              <select id="question-quality-filter" value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as QualityFilter)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800">
                <option value="ALL">ทั้งหมด</option><option value="COMPLETE">ข้อมูลครบ</option><option value="INCOMPLETE">ข้อมูลไม่ครบ</option><option value="DUPLICATE">อาจซ้ำ</option>
              </select>
            </div>
            <button type="button" onClick={resetQuestionFilters} disabled={!hasQuestionFilters} className="min-h-11 self-end rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">ล้างตัวกรองทั้งหมด</button>
          </div>
        )}
        
        {loading ? <AsyncState compact variant="loading" title="กำลังโหลดคลังข้อสอบ" /> : loadError ? <AsyncState compact variant="error" title="โหลดคลังข้อสอบไม่สำเร็จ" description={loadError} onRetry={() => fetchQuestions()} /> : (
            <div className="grid grid-cols-1 gap-4">
                {currentQuestions.map((q) => {
                  const questionCode = getQuestionCode(q.id);
                  const isLastSaved = lastSavedQuestion?.id === q.id;
                  const isHighlighted = highlightedQuestionId === q.id;
                  const isAnswerExpanded = expandedAnswerIds.has(q.id);
                  const choices = getQuestionChoices(q);
                  const answerSummary = getAnswerSummary(q);
                  const hasAnswer = !answerSummary.startsWith('ยังไม่ได้ระบุ');
                  const qualityIssues = questionQualityMap.get(q.id) || [];
                  const relatedDuplicateIds = duplicateQuestionMap.get(q.id) || [];

                  return (
                    <div
                      key={q.id}
                      id={`question-card-${q.id}`}
                      ref={(element) => {
                        if (element) questionCardRefs.current.set(q.id, element);
                        else questionCardRefs.current.delete(q.id);
                      }}
                      className={`p-4 md:p-5 border-2 rounded-3xl flex flex-col md:flex-row gap-5 items-start group transition-all duration-500 ${
                        isHighlighted
                          ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100 ring-4 ring-emerald-100'
                          : editingId === q.id
                            ? 'border-amber-400 bg-amber-50/10'
                            : 'border-slate-100 hover:border-blue-100 hover:shadow-lg'
                      }`}
                    >
                        <div className="w-full md:w-28 h-28 flex-shrink-0 relative">
                            {q.image_url ? <img src={q.image_url} alt={`รูปประกอบคำถาม ${questionCode}`} className="w-full h-full object-cover rounded-2xl bg-slate-50 border border-slate-100 shadow-inner" /> : <div className="w-full h-full bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 border border-slate-100 shadow-sm"><ImageIcon size={24}/></div>}
                            <div className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-slate-900/80 text-white text-[6px] font-black rounded uppercase tracking-tighter shadow-md border border-white/20">{q.pattern?.replace('_', ' ')}</div>
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-md text-[9px] font-black text-slate-700 border border-slate-200 bg-slate-50" title={`รหัสคำถาม ${q.id}`}>{questionCode}</span>
                                  <span className={`px-2 py-1 rounded-md text-[8px] font-black border ${q.type === 'INDUCTION' ? 'text-blue-700 border-blue-100 bg-blue-50' : q.type === 'WORK_PERMIT' ? 'text-purple-700 border-purple-100 bg-purple-50' : 'text-emerald-800 border-emerald-100 bg-emerald-50'}`}>{q.type}</span>
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black ${qualityIssues.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                                    {qualityIssues.length === 0 ? <CheckCircle2 size={12}/> : <AlertCircle size={12}/>} {qualityIssues.length === 0 ? 'ข้อมูลครบ' : `ข้อมูลไม่ครบ ${qualityIssues.length} จุด`}
                                  </span>
                                  {relatedDuplicateIds.length > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[9px] font-black text-red-800"><Copy size={12}/> อาจซ้ำ {relatedDuplicateIds.length + 1} รายการ</span>}
                                  {isLastSaved && (
                                    <span
                                      role="status"
                                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[9px] font-black text-emerald-800"
                                      title={`บันทึกเมื่อ ${lastSavedQuestion.savedAt.toLocaleTimeString('th-TH')}`}
                                    >
                                      <CheckCircle2 size={12} /> บันทึกแล้ว • เมื่อสักครู่
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleActive(q)}
                                      disabled={publishingId === q.id}
                                      aria-label={q.is_active === true ? `เปลี่ยน ${questionCode} เป็นฉบับร่าง` : `เผยแพร่ ${questionCode}`}
                                      className={`inline-flex min-h-11 min-w-[72px] items-center justify-center gap-1 rounded-lg px-2 text-[8px] font-black disabled:cursor-not-allowed disabled:opacity-50 ${q.is_active === true ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}
                                    >
                                      {publishingId === q.id && <Loader2 size={13} className="animate-spin"/>} {q.is_active === true ? 'เผยแพร่' : 'ฉบับร่าง'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenRevisionHistory(q)}
                                      aria-label={`ดูประวัติคำถาม ${questionCode}`}
                                      title="ดูประวัติและกู้คืนข้อมูล"
                                      className="min-h-11 min-w-11 p-3 text-slate-600 transition-colors hover:text-violet-700 active:scale-90"
                                    >
                                      <History size={16}/>
                                    </button>
                                    <button
                                      onClick={() => handleDuplicate(q)}
                                      disabled={duplicatingId === q.id}
                                      aria-label={`ทำสำเนาคำถาม ${questionCode}`}
                                      title="ทำสำเนาและปิดใช้งานไว้ก่อน"
                                      className="min-h-11 min-w-11 p-3 text-slate-600 hover:text-emerald-700 transition-colors active:scale-90 disabled:opacity-50"
                                    >
                                      {duplicatingId === q.id ? <Loader2 size={16} className="animate-spin"/> : <Copy size={16}/>}
                                    </button>
                                    <button onClick={() => handleEdit(q)} aria-label={`แก้ไขคำถาม ${questionCode}`} className="min-h-11 min-w-11 p-3 text-slate-600 hover:text-blue-700 transition-colors active:scale-90"><Edit3 size={16}/></button>
                                    <button onClick={() => handleDelete(q.id)} aria-label={`ลบคำถาม ${questionCode}`} className="min-h-11 min-w-11 p-3 text-slate-600 hover:text-red-700 transition-colors active:scale-90"><Trash2 size={16}/></button>
                                </div>
                            </div>
                            <h4 className="font-black text-slate-800 text-sm leading-relaxed">{q.content_th}</h4>
                            <p className="text-[10px] text-slate-600 italic leading-relaxed mb-4">{q.content_en}</p>
                            {(qualityIssues.length > 0 || relatedDuplicateIds.length > 0) && (
                              <div className="mb-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                                {qualityIssues.length > 0 && (
                                  <details className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
                                    <summary className="cursor-pointer text-[10px] font-black">ดูจุดที่ต้องแก้ {qualityIssues.length} จุด</summary>
                                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] font-bold">
                                      {qualityIssues.map((issue) => <li key={`${q.id}-${issue}`}>{issue}</li>)}
                                    </ul>
                                  </details>
                                )}
                                {relatedDuplicateIds.length > 0 && (
                                  <details className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-950">
                                    <summary className="cursor-pointer text-[10px] font-black">ดูคำถามที่อาจซ้ำ</summary>
                                    <p className="mt-2 text-[10px] font-bold">พบข้อความใกล้เคียงกับ {relatedDuplicateIds.map(getQuestionCode).join(', ')}</p>
                                    <p className="mt-1 text-[9px] text-red-800">ระบบแจ้งเตือนเท่านั้น กรุณาตรวจสอบก่อนลบหรือแก้ไข</p>
                                  </details>
                                )}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                                <span className="text-[9px] font-black text-slate-700 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
                                  {q.pattern === QuestionPattern.MATCHING ? `${choices.length} คู่จับคู่` : q.pattern === QuestionPattern.SHORT_ANSWER ? 'คำตอบแบบเขียน' : `${choices.length} ตัวเลือก`}
                                </span>
                                <span className={`max-w-full truncate text-[9px] font-black px-3 py-1.5 rounded-full border ${hasAnswer ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`} title={answerSummary}>
                                  เฉลย: {answerSummary}
                                </span>
                                <button
                                  type="button"
                                  aria-expanded={isAnswerExpanded}
                                  aria-controls={`question-answer-${q.id}`}
                                  onClick={() => setExpandedAnswerIds((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(q.id)) next.delete(q.id);
                                    else next.add(q.id);
                                    return next;
                                  })}
                                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[9px] font-black text-blue-700 hover:bg-blue-100"
                                >
                                  {isAnswerExpanded ? 'ซ่อนตัวเลือกและเฉลย' : 'ดูตัวเลือกและเฉลย'}
                                  <ChevronDown size={14} className={`transition-transform ${isAnswerExpanded ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                            {isAnswerExpanded && <QuestionAnswerDetails question={q} />}
                        </div>
                    </div>
                  );
                })}
                {filteredQuestions.length === 0 && <AsyncState compact variant="empty" title="ไม่พบข้อสอบ" description={hasQuestionFilters ? 'ไม่พบคำถามที่ตรงกับคำค้นหาและตัวกรองปัจจุบัน ลองล้างตัวกรองบางรายการ' : 'กดสร้างข้อสอบหรือนำเข้าไฟล์ Excel เพื่อเริ่มต้น'} />}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 mt-8 pt-6 border-t border-slate-50">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} aria-label="หน้าก่อนหน้า" className="min-h-11 min-w-11 p-2 bg-slate-50 rounded-xl hover:bg-slate-100 disabled:opacity-20 transition-all"><ChevronLeft size={20}/></button>
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-tighter shadow-sm bg-white px-4 py-2 rounded-xl border border-slate-100">Page {currentPage} / {totalPages}</span>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} aria-label="หน้าถัดไป" className="min-h-11 min-w-11 p-2 bg-slate-50 rounded-xl hover:bg-slate-100 disabled:opacity-20 transition-all"><ChevronRight size={20}/></button>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

const QuestionAnswerDetails = ({ question }: { question: any }) => {
  const choices = getQuestionChoices(question);

  if (question.pattern === QuestionPattern.SHORT_ANSWER) {
    return (
      <div id={`question-answer-${question.id}`} className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-700">คำตอบที่ถูกต้อง</p>
        <p className="text-sm font-bold text-slate-800">{choices[0]?.correct_answer || 'ยังไม่ได้ระบุเฉลย'}</p>
      </div>
    );
  }

  if (question.pattern === QuestionPattern.MATCHING) {
    return (
      <div id={`question-answer-${question.id}`} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-600">คู่คำตอบที่ถูกต้อง</p>
        {choices.length > 0 ? (
          <ol className="space-y-2">
            {choices.map((pair: any, index: number) => {
              const leftTh = pair?.left_th || pair?.left_text_th || '-';
              const rightTh = pair?.right_th || pair?.right_text_th || '-';
              const leftEn = pair?.left_en || pair?.left_text_en || '';
              const rightEn = pair?.right_en || pair?.right_text_en || '';
              return (
                <li key={`${question.id}-pair-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-100 text-[9px] text-blue-700">{index + 1}</span>
                    <span>{leftTh}</span><ArrowRightLeft size={13} className="flex-none text-emerald-700"/><span>{rightTh}</span>
                  </div>
                  {(leftEn || rightEn) && <p className="mt-1 pl-8 text-[10px] italic text-slate-600">{leftEn || '-'} ↔ {rightEn || '-'}</p>}
                </li>
              );
            })}
          </ol>
        ) : <p className="text-xs font-bold text-amber-800">ยังไม่ได้ระบุคู่คำตอบ</p>}
      </div>
    );
  }

  const correctIndex = getCorrectChoiceIndex(question);
  return (
    <div id={`question-answer-${question.id}`} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-600">ตัวเลือกและเฉลย</p>
      {choices.length > 0 ? (
        <ol className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {choices.map((choice: any, index: number) => {
            const isCorrect = index === correctIndex;
            return (
              <li key={`${question.id}-choice-${index}`} className={`rounded-xl border p-3 ${isCorrect ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start gap-2">
                  <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[9px] font-black ${isCorrect ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800">{choice?.text_th || 'ไม่มีข้อความภาษาไทย'}</p>
                    {choice?.text_en && <p className="mt-0.5 text-[10px] italic text-slate-600">{choice.text_en}</p>}
                  </div>
                  {isCorrect && <span className="inline-flex flex-none items-center gap-1 text-[9px] font-black text-emerald-800"><CheckCircle2 size={14}/> เฉลย</span>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="text-xs font-bold text-amber-800">ยังไม่มีตัวเลือกและเฉลย</p>}
    </div>
  );
};

const PatternTab = ({ active, onClick, icon, label }: any) => (
    <button onClick={onClick} className={`min-h-11 flex-1 flex items-center justify-center gap-2 py-3.5 px-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all border ${active ? 'bg-white text-blue-700 shadow-sm border-slate-200' : 'text-slate-600 hover:text-slate-800 border-transparent'}`}>
        {icon} <span className="hidden sm:inline">{label}</span>
    </button>
);

export default QuestionManager;
