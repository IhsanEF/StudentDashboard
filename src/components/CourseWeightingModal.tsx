import React, { useState, useEffect } from 'react';
import { Course, GradeCategory } from '../types';
import { useModalFocus } from '../hooks/useModalFocus';
import { X, Plus, Trash2, Sliders, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { getDefaultCategoriesForCourse } from '../services/gradeCalculatorService';

interface CourseWeightingModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  onSave: (updatedCourse: Course) => Promise<void> | void;
  saveError?: string | null;
}

export default function CourseWeightingModal({
  isOpen,
  onClose,
  course,
  onSave,
  saveError
}: CourseWeightingModalProps) {
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  const [categories, setCategories] = useState<GradeCategory[]>(() => {
    if (course.grade_categories && course.grade_categories.length > 0) {
      return JSON.parse(JSON.stringify(course.grade_categories));
    }
    return getDefaultCategoriesForCourse(course.course_code);
  });

  const [isSaving, setIsSaving] = useState(false);
  const [confirmTemplateOpen, setConfirmTemplateOpen] = useState(false);
  const [confirmNon100Open, setConfirmNon100Open] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfirmTemplateOpen(false);
      setConfirmNon100Open(false);
      if (course.grade_categories && course.grade_categories.length > 0) {
        setCategories(JSON.parse(JSON.stringify(course.grade_categories)));
      } else {
        setCategories(getDefaultCategoriesForCourse(course.course_code));
      }
    }
  // Snapshot updates for the same course must not overwrite the student's draft.
  }, [isOpen, course.id, course.course_code]);

  if (!isOpen) return null;

  const totalWeight = categories.reduce((sum, cat) => sum + (Number.isFinite(cat.weight) ? cat.weight : 0), 0);
  const isHundredPercent = Math.abs(totalWeight - 100) <= 0.01;
  const isInvalidTotal = Math.abs(totalWeight - 100) > 0.01;

  const handleAddCategory = () => {
    const newCat: GradeCategory = {
      id: `cat-${Date.now()}`,
      name: 'New Category',
      weight: Math.max(0, 100 - totalWeight),
      dropLowest: 0
    };
    setCategories([...categories, newCat]);
  };

  const handleUpdateCategory = (id: string, updates: Partial<GradeCategory>) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleDeleteCategory = (id: string) => {
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  const handleApplyTemplate = () => {
    if (categories.length === 0) {
      setCategories(getDefaultCategoriesForCourse(course.course_code));
    } else {
      setConfirmTemplateOpen(true);
    }
  };

  const handleConfirmTemplate = () => {
    setCategories(getDefaultCategoriesForCourse(course.course_code));
    setConfirmTemplateOpen(false);
  };

  const handleSaveWeights = async (saveAnyway: boolean = false) => {
    if (!saveAnyway && Math.abs(totalWeight - 100) > 0.01) {
      return;
    }
    setIsSaving(true);
    try {
      const sanitizedCategories: GradeCategory[] = categories.map(cat => ({
        ...cat,
        name: cat.name.trim() || 'Untitled Category',
        weight: Math.max(0, Number(cat.weight) || 0),
        dropLowest: Math.max(0, parseInt(String(cat.dropLowest || 0), 10) || 0)
      }));

      const updatedCourse: Course = {
        ...course,
        grade_categories: sanitizedCategories,
        weights_invalid: saveAnyway ? true : false
      };

      await onSave(updatedCourse);
      onClose();
    } catch (err) {
      console.error('Failed to save category weighting:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSaveWeights(false);
  };

  return (
    <div
      ref={modalRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-weighting-title"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
    >
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/70 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <Sliders size={20} />
            </div>
            <div>
              <h2 id="course-weighting-title" className="text-lg font-bold text-slate-900">
                Syllabus Weighting & Categories
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {course.course_code} - {course.course_name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Form */}
        <form id="weighting-form" onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="flex items-center justify-between text-xs bg-slate-100/80 p-3 rounded-xl border border-slate-200 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">Total Syllabus Weight:</span>
              <span className={`font-black text-sm px-2 py-0.5 rounded-md ${
                isHundredPercent ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {totalWeight}%
              </span>
            </div>
            {isHundredPercent ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle2 size={14} /> Total equals 100%
              </span>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-amber-700 font-semibold flex items-center gap-1">
                  <AlertCircle size={14} /> Weights sum to {totalWeight}% (target 100%)
                </span>
                <button
                  type="button"
                  id="save-anyway-header-link"
                  onClick={() => setConfirmNon100Open(true)}
                  disabled={isSaving}
                  className="text-xs text-amber-800 hover:text-amber-950 underline font-semibold cursor-pointer"
                >
                  Save anyway
                </button>
              </div>
            )}
          </div>

          {/* Explicit Confirmation for Non-100% Syllabus Weights (V4-136) */}
          {confirmNon100Open && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-amber-900">
                    Confirm non-100% syllabus weights
                  </p>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Syllabus weights currently sum to <strong>{totalWeight}%</strong> instead of 100%. Saving weights that do not sum to 100% can cause course grades, projected exam scores, and GPA calculations to report skewed figures. Are you sure you want to save anyway?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 pl-6">
                <button
                  type="button"
                  id="confirm-save-anyway-btn"
                  disabled={isSaving}
                  onClick={() => {
                    setConfirmNon100Open(false);
                    handleSaveWeights(true);
                  }}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Yes, save anyway'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmNon100Open(false)}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel & adjust weights
                </button>
              </div>
            </div>
          )}

          {/* Explicit Confirmation for Replacing with Template (V3-497) */}
          {confirmTemplateOpen && (
            <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl space-y-2 animate-in fade-in">
              <p className="text-xs text-blue-900 font-medium">
                Replace existing categories with a common course template? This will overwrite your current category names, weights, and drop-lowest rules.
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  id="confirm-template-btn"
                  onClick={handleConfirmTemplate}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Yes, use template
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTemplateOpen(false)}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 uppercase px-2">
              <span className="col-span-5">Category Name</span>
              <span className="col-span-3">Weight (%)</span>
              <span className="col-span-3">Drop Lowest</span>
              <span className="col-span-1 text-center">Del</span>
            </div>

            {categories.map((category) => (
              <div
                key={category.id}
                className="grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 p-2.5 rounded-xl hover:border-slate-300 transition-colors"
              >
                <div className="col-span-5">
                  <input
                    type="text"
                    required
                    value={category.name}
                    onChange={e => handleUpdateCategory(category.id, { name: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. Labs"
                  />
                </div>
                <div className="col-span-3">
                  <div className="relative">
                    <input
                      type="number"
                      required
                      min="0"
                      max="100"
                      step="0.5"
                      value={category.weight}
                      onChange={e => handleUpdateCategory(category.id, { weight: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-500 pr-6"
                    />
                    <span className="absolute right-2 top-1.5 text-xs font-bold text-slate-400 pointer-events-none">%</span>
                  </div>
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={category.dropLowest ?? 0}
                    onChange={e => handleUpdateCategory(category.id, { dropLowest: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
                    placeholder="0"
                    title="Number of lowest grades to drop automatically"
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(category.id)}
                    aria-label={`Remove category ${category.name}`}
                    disabled={categories.length <= 1}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleAddCategory}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
            >
              <Plus size={14} /> Add Category
            </button>

            <button
              type="button"
              id="apply-template-btn"
              onClick={handleApplyTemplate}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer"
            >
              <RefreshCw size={12} /> Use a common template
            </button>
          </div>
        </form>

        {saveError && <p role="alert" className="px-4 py-3 text-sm text-red-800 bg-red-50">{saveError}</p>}

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2.5 rounded-b-2xl">
          <div>
            {isInvalidTotal && (
              <button
                type="button"
                id="save-anyway-footer-link"
                onClick={() => setConfirmNon100Open(true)}
                disabled={isSaving}
                className="text-xs text-amber-700 hover:text-amber-900 underline font-semibold cursor-pointer"
              >
                Save anyway
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="weighting-form"
              id="save-weights-btn"
              disabled={isSaving || isInvalidTotal}
              className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving Weights...' : 'Save Syllabus Weights'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
