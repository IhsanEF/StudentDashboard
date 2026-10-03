import { useState, useMemo, useEffect, useRef } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { Course } from '../types';
import { getCourseColor, getUbcLetterGrade, getUbcGradePoints } from '../utils';
import { 
  GraduationCap, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  BookOpen, 
} from 'lucide-react';

interface UbcGpaScaleEntry {
  min: number;
  max: number;
  letter: string;
  gpa433: number;
  gpa400: number;
  description: string;
}

export const UBC_GRADE_SCALE: UbcGpaScaleEntry[] = [
  { min: 90, max: 100, letter: 'A+', gpa433: 4.33, gpa400: 4.00, description: 'Exceptional performance' },
  { min: 85, max: 89.9, letter: 'A',  gpa433: 4.00, gpa400: 3.90, description: 'Outstanding performance' },
  { min: 80, max: 84.9, letter: 'A-', gpa433: 3.70, gpa400: 3.70, description: 'Excellent performance' },
  { min: 76, max: 79.9, letter: 'B+', gpa433: 3.30, gpa400: 3.30, description: 'Very good performance' },
  { min: 72, max: 75.9, letter: 'B',  gpa433: 3.00, gpa400: 3.00, description: 'Good performance' },
  { min: 68, max: 71.9, letter: 'B-', gpa433: 2.70, gpa400: 2.70, description: 'Adequate performance' },
  { min: 64, max: 67.9, letter: 'C+', gpa433: 2.30, gpa400: 2.30, description: 'Satisfactory performance' },
  { min: 60, max: 63.9, letter: 'C',  gpa433: 2.00, gpa400: 2.00, description: 'Marginal performance' },
  { min: 55, max: 59.9, letter: 'C-', gpa433: 1.70, gpa400: 1.70, description: 'Borderline performance' },
  { min: 50, max: 54.9, letter: 'D',  gpa433: 1.00, gpa400: 1.00, description: 'Pass' },
  { min: 0,  max: 49.9, letter: 'F',  gpa433: 0.00, gpa400: 0.00, description: 'Fail' },
];

export function getUbcGpaFromPercentage(percent: number, scale: '4.33' | '4.00' = '4.33'): { letter: string; gpa: number } {
  // Use raw thresholds via getUbcLetterGrade without Math.round so 84.6% is consistently A- / 3.70 (V4-027)
  const letter = getUbcLetterGrade(percent);
  const gpa = getUbcGradePoints(letter, scale);
  return {
    letter: letter || 'F',
    gpa
  };
}

interface UbcGpaConverterProps {
  courseResults: {
    course: Course;
    result: {
      currentGrade: number | null;
      currentGradedWeight: number;
    };
  }[];
}

export default function UbcGpaConverter({ courseResults }: UbcGpaConverterProps) {
  const { updateCourse } = useTasksContext();
  const [scale, setScale] = useState<'4.33' | '4.00'>('4.33');
  const [showScaleTable, setShowScaleTable] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [creditDrafts, setCreditDrafts] = useState<Record<string, string>>({});
  const [creditError, setCreditError] = useState('');
  const [reportFallback, setReportFallback] = useState('');
  const reportRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (reportFallback) { reportRef.current?.focus(); reportRef.current?.select(); }
  }, [reportFallback]);

  // Manual final status toggle per course (V4-028)
  const [markedFinal, setMarkedFinal] = useState<Record<string, boolean>>({});

  // Prior cumulative credits & GPA for calculating cumulative vs sessional
  const [priorCredits, setPriorCredits] = useState('');
  const [priorGpas, setPriorGpas] = useState<Record<'4.33' | '4.00', string>>({ '4.33': '', '4.00': '' });
  const priorGpa = priorGpas[scale];
  const validPrior = priorCredits.trim() !== '' && priorGpa.trim() !== ''
    && Number.isFinite(Number(priorCredits)) && Number(priorCredits) >= 0 && Number(priorCredits) <= 180
    && Number.isFinite(Number(priorGpa)) && Number(priorGpa) >= 0 && Number(priorGpa) <= Number(scale);
  const [includePriorCumulative, setIncludePriorCumulative] = useState(false);

  // Map courses with grades, percentage of syllabus graded, and final status
  const rows = useMemo(() => {
    return courseResults.map(cr => {
      const code = cr.course.course_code;
      const credits = cr.course.credits ?? 3;
      const pct = cr.result.currentGrade;
      const gradedWeight = Math.max(0, Math.min(100, cr.result.currentGradedWeight ?? 0));
      const isFinal = (markedFinal[code] ?? false) || gradedWeight >= 99;
      const { letter, gpa } = pct !== null ? getUbcGpaFromPercentage(pct, scale) : { letter: 'N/A', gpa: 0 };
      const weightedPoints = pct !== null ? gpa * credits : 0;

      return {
        course: cr.course,
        courseCode: code,
        courseName: cr.course.course_name || 'Course',
        percentage: pct,
        gradedWeight,
        isFinal,
        credits,
        letter,
        gpa,
        weightedPoints,
        hasGrade: pct !== null
      };
    });
  }, [courseResults, markedFinal, scale]);

  const gradedRows = rows.filter(r => r.hasGrade);
  const totalSessionalCredits = gradedRows.reduce((sum, r) => sum + r.credits, 0);
  const completedCredits = gradedRows.filter(r => r.isFinal).reduce((sum, r) => sum + r.credits, 0);
  const totalSessionalPoints = gradedRows.reduce((sum, r) => sum + r.weightedPoints, 0);
  const allCoursesCompleted = gradedRows.length > 0 && gradedRows.every(r => r.isFinal);

  const weightedPercentageSum = gradedRows.reduce((sum, r) => sum + (r.percentage ?? 0) * r.credits, 0);
  const averagePercentage = totalSessionalCredits > 0 ? weightedPercentageSum / totalSessionalCredits : null;

  const sessionalGpa = totalSessionalCredits > 0 
    ? Math.round((totalSessionalPoints / totalSessionalCredits) * 100) / 100 
    : null;

  // UBC Official Academic Standing (V4-025)
  // Conferred only on final completion of all courses (100% graded)
  const standing = useMemo(() => {
    if (averagePercentage === null) return null;
    if (!allCoursesCompleted) {
      return {
        type: 'in-progress' as const,
        label: 'In-progress (provisional)',
        badgeText: 'In-progress (provisional)',
        description: 'Official academic standing is conferred only when 100% of syllabus weight is graded.',
        colorClass: 'text-amber-800 bg-amber-50 border-amber-200'
      };
    }
    if (averagePercentage >= 80) {
      return {
        type: 'first-class' as const,
        label: 'First Class',
        badgeText: 'First Class (80%+)',
        description: 'First Class standing (80%+ average). Dean\'s Honour List requires faculty-specific credit minimums and standing rules.',
        colorClass: 'text-emerald-800 bg-emerald-50 border-emerald-200'
      };
    }
    if (averagePercentage >= 65) {
      return {
        type: 'second-class' as const,
        label: 'Second Class',
        badgeText: 'Second Class (65–79%)',
        description: 'Second Class standing (65–79% average).',
        colorClass: 'text-blue-800 bg-blue-50 border-blue-200'
      };
    }
    if (averagePercentage >= 50) {
      return {
        type: 'pass' as const,
        label: 'Pass',
        badgeText: 'Pass (50–64%)',
        description: 'Passing standing (50–64% average).',
        colorClass: 'text-slate-800 bg-slate-100 border-slate-200'
      };
    }
    return {
      type: 'failing' as const,
      label: 'Failing',
      badgeText: 'Failing (<50%)',
      description: 'Failing standing (average below 50%).',
      colorClass: 'text-rose-800 bg-rose-50 border-rose-200'
    };
  }, [averagePercentage, allCoursesCompleted]);

  // No cumulative history is inferred from placeholders or missing inputs.
  const cumulativeGpa = useMemo(() => {
    if (!includePriorCumulative) return sessionalGpa;
    if (!validPrior) return null;
    const combinedPoints = Number(priorCredits) * Number(priorGpa) + totalSessionalPoints;
    const combinedCredits = Number(priorCredits) + totalSessionalCredits;
    return combinedCredits > 0 ? Math.round((combinedPoints / combinedCredits) * 100) / 100 : null;
  }, [includePriorCumulative, validPrior, priorCredits, priorGpa, totalSessionalCredits, totalSessionalPoints, sessionalGpa]);

  const saveCredits = async (course: Course, draft: string) => {
    if (!draft.trim() || !Number.isFinite(Number(draft)) || Number(draft) < 0 || Number(draft) > 30) {
      setCreditError('Enter credits between 0 and 30. GPA uses the last saved credits until you save a valid value.');
      return;
    }
    try {
      await updateCourse({ ...course, credits: Number(draft) });
      setCreditError('');
    } catch {
      setCreditError('Could not save course credits. Try again.');
    }
  };

  const handleToggleFinal = (courseCode: string, isChecked: boolean) => {
    setMarkedFinal(prev => ({
      ...prev,
      [courseCode]: isChecked
    }));
  };

  const handleCopyReport = async () => {
    setCopied(false);
    const scaleLabel = scale === '4.33' ? 'Common 4.33 conversion' : 'Standard / OMSAS (4.00 Scale)';
    const textReport = [
      `=========================================`,
      `UBC ESTIMATED / SESSIONAL GPA CONVERSION REPORT (UNOFFICIAL)`,
      `Grading Scale: ${scaleLabel}`,
      `Generated: ${new Date().toLocaleDateString()}`,
      `Status: ${allCoursesCompleted ? 'All courses completed (Final)' : 'In-progress coursework (Estimated)'}`,
      `=========================================`,
      ``,
      `SESSIONAL BREAKDOWN:`,
      ...rows.map(r => {
        if (!r.hasGrade) {
          return `${r.courseCode.padEnd(10)} | ${r.credits} cr | In Progress (No final grade yet)`;
        }
        return `${r.courseCode.padEnd(10)} | ${r.credits} cr | ${r.percentage?.toFixed(1)}% (${r.gradedWeight.toFixed(0)}% syllabus graded${r.isFinal ? ' - Final' : ''}) | Grade: ${r.letter.padEnd(2)} | GPA: ${r.gpa.toFixed(2)}`;
      }),
      ``,
      `SESSIONAL SUMMARY:`,
      `Total Credits: ${totalSessionalCredits} (${completedCredits} completed, ${totalSessionalCredits - completedCredits} in progress)`,
      `${allCoursesCompleted ? 'Sessional GPA' : 'Estimated GPA (in-progress)'}: ${sessionalGpa !== null ? sessionalGpa.toFixed(2) : 'N/A'} / ${scale}`,
      standing ? `Academic Standing: ${allCoursesCompleted ? standing.badgeText : standing.label}` : '',
      includePriorCumulative && validPrior ? `Prior Credits: ${priorCredits} (Prior GPA: ${Number(priorGpa).toFixed(2)})\nCumulative GPA: ${includePriorCumulative && !validPrior ? 'Enter prior credits and GPA' : cumulativeGpa !== null ? cumulativeGpa.toFixed(2) : 'N/A'} / ${scale}` : '',
      ``,
      `NOTE: This is an unofficial planning estimate and is not an official UBC transcript.`,
      `=========================================`
    ].filter(Boolean).join('\n');

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(textReport);
      setReportFallback('');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setReportFallback(textReport);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700">
            <GraduationCap size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black text-slate-900">UBC Percentage → GPA Converter</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700">
                Common conversion
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Converts percentage-native UBC grades to 4.33 and 4.0 scales for scholarships, graduate school, and exchange programs.
            </p>
          </div>
        </div>

        {/* Scale Switcher & Export */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-slate-100 p-0.5 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setScale('4.33')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                scale === '4.33' ? 'bg-white text-indigo-700 shadow-2xs font-extrabold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Common 4.33 conversion
            </button>
            <button
              type="button"
              onClick={() => setScale('4.00')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                scale === '4.00' ? 'bg-white text-indigo-700 shadow-2xs font-extrabold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              4.0 Scale (OMSAS)
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 rounded-xl transition-colors cursor-pointer"
            title="Copy formatted GPA report to clipboard"
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Export Report'}</span>
          </button>
        </div>
      </div>

      {reportFallback && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-slate-700">Clipboard unavailable. Select and copy your report below.</p>
          <label htmlFor="gpa-report" className="text-xs font-semibold text-slate-700">GPA report</label>
          <textarea id="gpa-report" ref={reportRef} readOnly value={reportFallback} rows={12}
            onFocus={e => e.target.select()} className="w-full border border-slate-300 rounded-lg p-3 text-xs" />
        </div>
      )}
      {creditError && <p role="alert" className="text-sm text-rose-700">{creditError}</p>}

      {/* GPA KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Sessional / Estimated GPA */}
        <div className="bg-gradient-to-br from-indigo-50/60 to-blue-50/30 border border-indigo-100 rounded-2xl p-4">
          <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">
            {allCoursesCompleted ? 'Sessional GPA (Final)' : 'Estimated GPA (in-progress)'}
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-black text-slate-900">
              {sessionalGpa !== null ? sessionalGpa.toFixed(2) : 'N/A'}
            </span>
            <span className="text-xs font-bold text-slate-500">/ {scale}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {allCoursesCompleted
              ? `Calculated over ${totalSessionalCredits} final graded credits this session.`
              : `Estimated over ${totalSessionalCredits} registered credits (${completedCredits} completed, ${totalSessionalCredits - completedCredits} in progress).`}
          </p>
        </div>

        {/* Cumulative GPA */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
              {allCoursesCompleted ? 'Cumulative GPA' : 'Estimated Cumulative GPA'}
            </span>
            <button
              type="button"
              onClick={() => setIncludePriorCumulative(!includePriorCumulative)}
              className="text-[10px] font-semibold text-indigo-600 hover:underline cursor-pointer"
            >
              {includePriorCumulative ? 'Disable Prior' : '+ Add Prior Terms'}
            </button>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-black text-slate-900">
              {includePriorCumulative && !validPrior ? 'Enter prior credits and GPA' : cumulativeGpa !== null ? cumulativeGpa.toFixed(2) : 'N/A'}
            </span>
            <span className="text-xs font-bold text-slate-500">/ {scale}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {includePriorCumulative && validPrior 
              ? `Includes ${priorCredits} prior credits @ ${Number(priorGpa).toFixed(2)} GPA`
              : includePriorCumulative ? 'Enter both values on the selected scale to include prior terms.' : 'Current session only (tap to factor prior credits)'}
          </p>
        </div>

        {/* UBC Standing Reference */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
              Academic Standing
            </span>
            <div className="mt-1">
              {standing ? (
                allCoursesCompleted ? (
                  <div className="space-y-1">
                    <span className={`inline-flex items-center gap-1 text-sm font-extrabold px-2.5 py-1 rounded-lg border ${standing.colorClass}`}>
                      {standing.badgeText}
                    </span>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      {standing.description}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg border ${standing.colorClass}`}>
                      {standing.label}
                    </span>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      {averagePercentage !== null ? `${averagePercentage.toFixed(1)}% current avg — standing awarded on final grades.` : standing.description}
                    </p>
                  </div>
                )
              ) : (
                <span className="text-xs text-slate-400">Awaiting grade input</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowScaleTable(!showScaleTable)}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mt-2 cursor-pointer"
          >
            <span>View conversion scale table</span>
            {showScaleTable ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Prior terms inputs (collapsible) */}
      {includePriorCumulative && (
        <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-4 animate-in fade-in">
          <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900 mb-2">
            Prior Academic History
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
            <div>
              <label htmlFor="prior-credits" className="block text-[11px] font-semibold text-slate-700 mb-1">
                Prior Completed Credits (e.g. 30, 60)
              </label>
              <input
                type="number"
                min="0"
                max="180"
                id="prior-credits"
                value={priorCredits}
                onChange={(e) => setPriorCredits(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <div>
              <label htmlFor="prior-gpa" className="block text-[11px] font-semibold text-slate-700 mb-1">
                Prior Cumulative GPA (on {scale} scale)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={parseFloat(scale)}
                id="prior-gpa"
                value={priorGpa}
                onChange={(e) => setPriorGpas(prev => ({ ...prev, [scale]: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* UBC Scale Table reference */}
      {showScaleTable && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto animate-in fade-in">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <BookOpen size={14} className="text-indigo-600" />
              Common Grade Conversion Table
            </h4>
            <span className="text-[10px] text-slate-500">Letter bands: UBC Academic Calendar; GPA mapping: common 4.33 / OMSAS conventions (UBC does not issue a GPA)</span>
          </div>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                <th className="py-2 px-3">UBC Percentage</th>
                <th className="py-2 px-3">Letter Grade</th>
                <th className="py-2 px-3">Common 4.33 conversion</th>
                <th className="py-2 px-3">OMSAS 4.0 Scale</th>
                <th className="py-2 px-3">Standing Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60">
              {UBC_GRADE_SCALE.map((entry) => (
                <tr key={entry.letter} className="hover:bg-white transition-colors">
                  <td className="py-1.5 px-3 font-semibold text-slate-800">{entry.min}% - {entry.max}%</td>
                  <td className="py-1.5 px-3 font-bold text-indigo-700">{entry.letter}</td>
                  <td className="py-1.5 px-3 font-mono font-bold text-slate-900">{entry.gpa433.toFixed(2)}</td>
                  <td className="py-1.5 px-3 font-mono font-bold text-slate-700">{entry.gpa400.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-slate-500 text-[11px]">{entry.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Course Breakdown Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <th className="py-2.5 px-3">Course Code</th>
              <th className="py-2.5 px-3">Course Name</th>
              <th className="py-2.5 px-3">Current %</th>
              <th className="py-2.5 px-3">% Graded</th>
              <th className="py-2.5 px-3">Letter</th>
              <th className="py-2.5 px-3">Credits</th>
              <th className="py-2.5 px-3">Grade Points ({scale})</th>
              <th className="py-2.5 px-3 text-right">Weighted Quality Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.courseCode} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3 px-3 font-bold text-slate-900">
                  <span className={`inline-block px-2 py-0.5 rounded-md ${getCourseColor(row.courseCode)}`}>
                    {row.courseCode}
                  </span>
                </td>
                <td className="py-3 px-3 text-slate-600 max-w-[180px] truncate font-medium">
                  {row.courseName}
                </td>
                <td className="py-3 px-3 font-bold text-slate-800">
                  {row.percentage !== null ? `${row.percentage.toFixed(1)}%` : (
                    <span className="text-slate-400 italic">No grades yet</span>
                  )}
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${row.isFinal ? 'text-emerald-700' : 'text-slate-600'}`}>
                      {row.gradedWeight.toFixed(0)}%
                    </span>
                    <label className="inline-flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded transition-colors" title="Mark course as final (100% completed)">
                      <input
                        type="checkbox"
                        checked={row.isFinal}
                        onChange={(e) => handleToggleFinal(row.courseCode, e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-3 h-3 cursor-pointer"
                      />
                      <span>Final</span>
                    </label>
                  </div>
                </td>
                <td className="py-3 px-3 font-extrabold text-indigo-700">
                  {row.letter}
                </td>
                <td className="py-3 px-3">
                  <input
                    type="number"
                    min="0"
                    max="30"
                    step="any"
                    aria-label={`Credits for ${row.courseCode}`}
                    value={creditDrafts[row.courseCode] ?? String(row.credits)}
                    onChange={e => setCreditDrafts(prev => ({ ...prev, [row.courseCode]: e.target.value }))}
                    onBlur={e => saveCredits(row.course, e.target.value)}
                    className="w-14 px-1.5 py-1 text-xs font-bold border border-slate-200 rounded-md text-center focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                    title="Change course credit weight (default 3.0)"
                  />
                </td>
                <td className="py-3 px-3 font-mono font-bold text-slate-900">
                  {row.hasGrade ? row.gpa.toFixed(2) : '—'}
                </td>
                <td className="py-3 px-3 font-mono font-bold text-slate-800 text-right">
                  {row.hasGrade ? row.weightedPoints.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
