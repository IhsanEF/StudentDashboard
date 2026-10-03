import fs from 'node:fs';
import ts from 'typescript';

// Guard the audited status and import surfaces. Slate-400 may colour decorative
// icons, but readable labels and hints must use slate-600 (700 on slate-100).
const surfaces = ['DashboardLayout', 'GradesTab', 'CourseGradeDetailCard', 'ProgressTab', 'SmartImportModal', 'SyllabusImportModal'];
let failed = false;
for (const surface of surfaces) {
  const file = `src/components/${surface}.tsx`;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = node => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const tag = opening.tagName.getText(source);
      const className = opening.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'className');
      const hidden = opening.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'aria-hidden' && ['"true"', "'true'", '{true}'].includes(attr.initializer?.getText(source)));
      const readable = child => ts.isJsxText(child) ? Boolean(child.text.trim())
        : ts.isJsxExpression(child) ? Boolean(child.expression)
        : ts.isJsxElement(child) && /^[a-z]/.test(child.openingElement.tagName.getText(source)) && child.children.some(readable);
      const hasText = node.children.some(readable);
      if (/^[a-z]/.test(tag) && hasText && !hidden && /\btext-slate-400\b/.test(className?.initializer?.getText(source) ?? '')) {
        const { line } = source.getLineAndCharacterOfPosition(opening.getStart(source));
        console.error(`${file}:${line + 1}: Informational text cannot use slate-400; use slate-600 or slate-700.`);
        failed = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (failed) process.exitCode = 1;
