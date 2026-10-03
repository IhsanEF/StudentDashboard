import { useState, useMemo, useEffect, useId } from 'react';
import { CourseGradeCalculationResult } from '../services/gradeCalculatorService';
import { Target, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getUbcLetterGrade } from '../utils';

interface FinalExamCalculatorCardProps {
  courseResult: CourseGradeCalculationResult;
  actualResult?: CourseGradeCalculationResult;
  finalExamWeight: number; // e.g. 35%
}

const UBC_TARGET_PRESETS = [
  { label: 'A+ (90%)', value: 90 },
  { label: 'A (85%)', value: 85 },
  { label: 'A- (80%)', value: 80 },
  { label: 'B+ (76%)', value: 76 },
  { label: 'B (72%)', value: 72 },
  { label: 'B- (68%)', value: 68 },
  { label: 'Pass (50%)', value: 50 },
];

export default function FinalExamCalculatorCard({
  courseResult,
  actualResult,
  finalExamWeight
}: FinalExamCalculatorCardProps) {
  const isSandbox = Boolean(courseResult.hasWhatIfOverrides);
  const effectiveBaseResult = actualResult || courseResult;
  const currentGrade = effectiveBaseResult.currentGrade;
  const [targetPercentage, setTargetPercentage] = useState<number>(80);
  const id = useId();
  const [weightInput, setWeightInput] = useState(String(finalExamWeight));
  useEffect(() => setWeightInput(String(finalExamWeight)), [finalExamWeight]);
  const parsedWeight = weightInput.trim() === '' ? finalExamWeight : Number.parseFloat(weightInput);
  const isCustomWeight = weightInput.trim() !== '' && parsedWeight !== finalExamWeight;
  const customWeight = Number.isFinite(parsedWeight) && parsedWeight > 0 && parsedWeight <= 100 ? parsedWeight : 0;
  // State for user-adjustable expected scores on ungraded non-final categories
  const [expectedScores, setExpectedScores] = useState<Record<string, number>>({});

  // Identify final exam category vs other categories
  const finalCategory = useMemo(() => {
    return courseResult.categories.find(c =>
      c.category.name.toLowerCase().includes('final')
    );
  }, [courseResult.categories]);

  const finalHasScore = useMemo(() => {
    if (!finalCategory) return false;
    return finalCategory.hasGradedItems && typeof finalCategory.categoryAverage === 'number' && Number.isFinite(finalCategory.categoryAverage);
  }, [finalCategory]);

  const nonFinalCategories = useMemo(() => {
    return courseResult.categories.filter(c => c !== finalCategory);
  }, [courseResult.categories, finalCategory]);

  const gradedCategories = useMemo(() => {
    return nonFinalCategories.filter(
      c => c.hasGradedItems && typeof c.categoryAverage === 'number' && Number.isFinite(c.categoryAverage)
    );
  }, [nonFinalCategories]);

  const ungradedCategories = useMemo(() => {
    return nonFinalCategories.filter(
      c => !c.hasGradedItems || typeof c.categoryAverage !== 'number' || !Number.isFinite(c.categoryAverage)
    );
  }, [nonFinalCategories]);

  // Banked weighted points from graded coursework
  const { bankedPoints, bankedWeight, assumedUngradedPoints, totalUngradedWeight } = useMemo(() => {
    if (currentGrade === null || !Number.isFinite(currentGrade)) {
      return { bankedPoints: 0, bankedWeight: 0, assumedUngradedPoints: 0, totalUngradedWeight: 0 };
    }

    let bPoints = 0;
    let bWeight = 0;

    if (gradedCategories.length > 0) {
      for (const cat of gradedCategories) {
        const catWeight = cat.weight || 0;
        bPoints += (cat.categoryAverage! * (catWeight / 100));
        bWeight += catWeight;
      }
    } else {
      // Fallback if categories are not defined: assume currentGrade covers non-final weight
      const nonFinalWeight = Math.max(0, 100 - customWeight);
      bPoints = currentGrade * (nonFinalWeight / 100);
      bWeight = nonFinalWeight;
    }

    let aPoints = 0;
    let uWeight = 0;

    for (const cat of ungradedCategories) {
      const catKey = cat.category.id || cat.category.name;
      const catWeight = cat.weight || 0;
      uWeight += catWeight;
      const expectedScore = expectedScores[catKey] ?? Math.round(currentGrade * 10) / 10;
      aPoints += (expectedScore * (catWeight / 100));
    }

    return {
      bankedPoints: bPoints,
      bankedWeight: bWeight,
      assumedUngradedPoints: aPoints,
      totalUngradedWeight: uWeight
    };
  }, [currentGrade, gradedCategories, ungradedCategories, expectedScores, customWeight]);

  // Projected required score on the final exam
  const {
    requiredScore,
    hasComputedScore,
    isAchievable,
    isGuaranteed,
    bestCaseGrade,
    worstCaseGrade,
    targetLetter
  } = useMemo(() => {
    const letter = getUbcLetterGrade(targetPercentage);

    if (currentGrade === null || !Number.isFinite(currentGrade) || customWeight <= 0) {
      return {
        requiredScore: null,
        hasComputedScore: false,
        isAchievable: true,
        isGuaranteed: false,
        bestCaseGrade: 0,
        worstCaseGrade: 0,
        targetLetter: letter
      };
    }

    const finalRatio = Math.max(0.001, customWeight / 100);
    const pointsNeededFromFinal = targetPercentage - bankedPoints - assumedUngradedPoints;
    const rawRequired = pointsNeededFromFinal / finalRatio;
    const roundedRequired = Math.round(rawRequired * 10) / 10;

    // Worst Case: 0% on unwritten work (all ungraded non-final categories at 0% AND 0% on final exam)
    const worstCase = Math.round(bankedPoints * 10) / 10;

    // Best Case: 100% on unwritten work (all ungraded non-final categories at 100% AND 100% on final exam)
    const bestCase = Math.min(100, Math.round((bankedPoints + totalUngradedWeight + customWeight) * 10) / 10);

    const guaranteed = worstCase >= targetPercentage || roundedRequired <= 0;
    const achievable = roundedRequired <= 100;

    return {
      requiredScore: roundedRequired,
      hasComputedScore: true,
      isAchievable: achievable,
      isGuaranteed: guaranteed,
      bestCaseGrade: bestCase,
      worstCaseGrade: worstCase,
      targetLetter: letter
    };
  }, [currentGrade, targetPercentage, customWeight, bankedPoints, assumedUngradedPoints, totalUngradedWeight]);

  // Summary string of assumptions for display
  const assumptionSummary = useMemo(() => {
    if (ungradedCategories.length === 0 || currentGrade === null) return '';
    return ungradedCategories
      .map(c => {
        const catKey = c.category.id || c.category.name;
        const score = expectedScores[catKey] ?? Math.round(currentGrade * 10) / 10;
        return `${c.category.name} at ${score.toFixed(1)}%`;
      })
      .join(', ');
  }, [ungradedCategories, expectedScores, currentGrade]);

  const currentBaseGrade = useMemo(() => {
    if (currentGrade === null || !Number.isFinite(currentGrade)) return null;
    if (bankedWeight > 0) {
      return bankedPoints / (bankedWeight / 100);
    }
    return currentGrade;
  }, [currentGrade, bankedPoints, bankedWeight]);

  if (finalHasScore) {
    const projected = courseResult.projectedGrade ?? courseResult.currentGrade ?? 0;
    const projectedStr = projected.toFixed(1);
    const projectedLetter = getUbcLetterGrade(projected);
    const finalScore = finalCategory?.categoryAverage !== null && finalCategory?.categoryAverage !== undefined
      ? finalCategory.categoryAverage.toFixed(1)
      : null;

    return (
      <details className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <summary className="text-sm font-bold text-slate-800 cursor-pointer">What do I need on the final?</summary>
        <div className="space-y-4 mt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <Target size={18} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-sm">
                Target Final Exam Calculator
              </h4>
              <p className="text-xs text-slate-500">
                {`Final already graded - course grade ${projectedStr}%`}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Course Grade</span>
            <span className="text-sm font-black text-slate-800">{`${projectedStr}% (${projectedLetter})`}</span>
          </div>
        </div>

        <div className="rounded-xl p-4 border bg-indigo-50/80 border-indigo-200 text-indigo-950">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold">
              {`Final already graded - course grade ${projectedStr}%`}
            </span>
            <span className="text-xs font-bold text-indigo-800 bg-indigo-100 px-2.5 py-0.5 rounded-full">
              {projectedLetter}
            </span>
          </div>
          <p className="text-xs text-indigo-900/80 mt-1.5">
            {`The final exam already has a score entered${finalScore ? ` (${finalScore}%)` : ''}. To calculate a target required score, clear the final exam score in Try scores (what-if).`}
          </p>
        </div>
        </div>
      </details>
    );
  }

  return (
    <details className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <summary className="text-sm font-bold text-slate-800 cursor-pointer">What do I need on the final?</summary>
        <div className="space-y-4 mt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
            <Target size={18} />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 text-sm">
              Target Final Exam Calculator
            </h4>
            <p className="text-xs text-slate-500">
              Calculate exact score needed on remaining finals using syllabus weighting
            </p>
          </div>
        </div>

        {currentBaseGrade !== null && (
          <div className="text-right">
            <span className={`text-[11px] font-bold uppercase tracking-wider block ${isSandbox && !actualResult ? 'text-amber-600' : 'text-slate-400'}`}>
              {isSandbox && !actualResult ? 'Sandbox Base' : 'Current Base'}
            </span>
            <span className="text-sm font-black text-slate-800">{currentBaseGrade.toFixed(1)}% ({getUbcLetterGrade(currentBaseGrade)})</span>
          </div>
        )}
      </div>

      {/* Target Grade Selector & Final Weight */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div>
          <label htmlFor={`${id}-target-grade-select`} className="text-xs font-bold text-slate-600 uppercase block mb-1.5">
            Target Desired Grade:
          </label>
          <select
            id={`${id}-target-grade-select`}
            value={targetPercentage}
            onChange={e => setTargetPercentage(Number(e.target.value))}
            className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 cursor-pointer outline-none focus:border-blue-500"
          >
            {!UBC_TARGET_PRESETS.some(preset => preset.value === targetPercentage) && <option value={targetPercentage}>Custom ({targetPercentage}%)</option>}
            {UBC_TARGET_PRESETS.map(preset => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label="Custom target grade percentage"
            min="0"
            max="100"
            value={targetPercentage}
            onChange={e => setTargetPercentage(Math.min(100, Math.max(0, Number(e.target.value))))}
            className="ml-2 w-20 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
          />
        </div>

        <div>
          <label htmlFor={`${id}-final-weight-input`} className="text-xs font-bold text-slate-600 uppercase block mb-1.5">
            Final Exam Weight (% of syllabus):
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-final-weight-input`}
              type="number"
              min="0.1"
              max="100"
              step="any"
              value={weightInput}
              aria-invalid={customWeight === 0}
              aria-describedby={customWeight === 0 ? `${id}-final-weight-error` : undefined}
              onChange={e => setWeightInput(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 w-24 outline-none focus:border-blue-500"
            />
            <span className="text-xs text-slate-500 font-medium">
              {isCustomWeight ? '(custom)' : '(default from course syllabus)'}
            </span>
          </div>
        </div>
      </div>

      {customWeight === 0 && <p id={`${id}-final-weight-error`} role="status" className="text-xs text-red-700">Enter a final exam weight greater than 0 and up to 100% to calculate a target score.</p>}

      {/* Ungraded non-final categories assumption controls */}
      {currentGrade !== null && ungradedCategories.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700">Ungraded Coursework Assumptions:</span>
            <span className="text-slate-500 text-[11px] italic">Adjust expected scores below</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ungradedCategories.map(c => {
              const catKey = c.category.id || c.category.name;
              const currentVal = expectedScores[catKey] ?? Math.round(currentGrade * 10) / 10;
              return (
                <div key={catKey} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-slate-700 truncate mr-2" title={c.category.name}>
                    {c.category.name} <span className="text-slate-400">({c.weight}%)</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={currentVal}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        setExpectedScores(prev => ({
                          ...prev,
                          [catKey]: isNaN(val) ? 0 : Math.min(100, Math.max(0, val))
                        }));
                      }}
                      className="w-16 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold text-slate-800 outline-none focus:border-indigo-500"
                    />
                    <span className="text-slate-500 font-bold">%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Calculation Output Callout */}
      <div className={`rounded-xl p-4 border transition-all ${
        !hasComputedScore
          ? 'bg-slate-50 border-slate-200 text-slate-800'
          : isGuaranteed
          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
          : !isAchievable
          ? 'bg-amber-50/80 border-amber-200 text-amber-950'
          : requiredScore !== null && requiredScore <= 70
          ? 'bg-blue-50/80 border-blue-200 text-blue-950'
          : 'bg-indigo-50/80 border-indigo-200 text-indigo-950'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider opacity-75">
                {ungradedCategories.length > 0 ? 'Projected Score Needed on Final Exam' : 'Score Needed on Final Exam'}
              </span>
              {ungradedCategories.length > 0 && currentGrade !== null && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md">
                  Projected
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              {!hasComputedScore ? (
                <span className="text-xl font-bold">Needs graded assignments first</span>
              ) : isGuaranteed ? (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-emerald-700">0.0%</span>
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 size={12} /> Already Guaranteed!
                  </span>
                </div>
              ) : !isAchievable ? (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-rose-600">
                    {typeof requiredScore === 'number' ? `${requiredScore.toFixed(1)}%` : 'N/A'}
                  </span>
                  <span className="text-xs font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle size={12} /> Exceeds 100%
                  </span>
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black">
                    {typeof requiredScore === 'number' ? `${requiredScore.toFixed(1)}%` : 'N/A'}
                  </span>
                  {typeof requiredScore === 'number' && (
                    <span className="text-xs font-bold opacity-80">
                      ({getUbcLetterGrade(requiredScore)})
                    </span>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs opacity-85">
              {currentGrade === null || !hasComputedScore
                ? 'Add at least one graded assignment and this will show the score you need on the final.'
                : isGuaranteed
                ? `Even with a 0% on the final exam, your minimum course grade is guaranteed at ${worstCaseGrade.toFixed(1)}%.`
                : !isAchievable
                ? `Targeting ${targetPercentage}% requires >100% on the final. Your maximum achievable course grade with 100% on the final is ${bestCaseGrade.toFixed(1)}%.`
                : typeof requiredScore === 'number'
                ? `Score at least ${requiredScore.toFixed(1)}% on the final exam to reach ${targetPercentage}% (${targetLetter}) overall.${assumptionSummary ? ` (assumes ${assumptionSummary})` : ''}`
                : 'Add at least one graded assignment and this will show the score you need on the final.'}
            </p>
          </div>

          {currentGrade !== null && hasComputedScore && (
            <div className="bg-white/80 backdrop-blur-xs rounded-xl p-3 border border-slate-200/60 shrink-0 space-y-1 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 font-medium">If you ace the rest:</span>
                <span className="font-bold text-slate-800">{bestCaseGrade.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 font-medium">Worst Case (0% on unwritten work):</span>
                <span className="font-bold text-slate-800">{worstCaseGrade.toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </details>
  );
}
