import axe from 'axe-core';
export function installAuditTools() {
  const panel = document.createElement('details'); panel.id = 'audit-tools';
  panel.style.cssText = 'position:fixed;right:8px;top:64px;z-index:9999;background:white;color:#111827;border:1px solid #475569;padding:8px;max-width:340px;max-height:45vh;overflow:auto;font:12px system-ui';
  const summary = document.createElement('summary'); summary.textContent = 'Local audit tools'; panel.append(summary);
  const scan = document.createElement('button'); scan.textContent = 'Run accessibility scan'; scan.type = 'button'; panel.append(scan);
  const output = document.createElement('textarea'); output.id = 'audit-results'; output.readOnly = true; output.setAttribute('aria-label', 'Audit results'); output.style.cssText = 'display:block;width:300px;height:180px'; panel.append(output);
  scan.onclick = async () => {
    scan.disabled = true; output.value = 'Running';
    try {
      const results = await axe.run({ exclude: [['#audit-tools']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
      const visible = (el: Element) => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && el.checkVisibility({ checkVisibilityCSS:true, checkOpacity:true }) && !el.closest('[inert],#audit-tools'); };
      const controls = (root: ParentNode) => [...root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary')].filter(visible).length;
      output.value = JSON.stringify({ date:new Date().toISOString(), viewport:{width:innerWidth,height:innerHeight}, screen:document.querySelector('main h1')?.textContent || document.querySelector('h1')?.textContent,
        controls:{page:controls(document), main:document.querySelector('main') ? controls(document.querySelector('main')!) : null},
        violations:results.violations.filter(v=>v.nodes.some(n=>!n.target.some(t=>String(t).includes('audit-tools')))).map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),
        incomplete:results.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})), passCount:results.passes.length });
    } catch { output.value = JSON.stringify({error:'Scan did not complete'}); }
    scan.disabled = false;
  };
  window.addEventListener('keydown', event => { if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'a') { event.preventDefault(); scan.click(); } });
  document.body.append(panel);
}
