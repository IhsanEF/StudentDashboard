import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import crypto from 'node:crypto';

const bundle = await build({ entryPoints: ['src/components/FeedbackWidget.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [{ name: 'feedback-boundaries', setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime|lucide-react)$|^\.\.\/auth$|\/useModalFocus$/ }, args => ({ path: args.path, namespace: 'boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents:
      path === 'react' ? 'export const {useState,useRef} = globalThis.hooks;'
        : path === 'react/jsx-runtime' ? "export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment='fragment';"
        : path === 'lucide-react' ? 'export const CheckCircle2=0,MessageSquare=0,Send=0,X=0;'
        : path === '../auth' ? 'export const auth=globalThis.auth; export const getAuthHeader=async()=>({Authorization:"Bearer account"});'
        : 'export const useModalFocus=()=>({modalRef:{},handleBackdropClick:()=>{}});'
    }));
  } }] });
function harness(demo = false) {
  const slots: any[] = [], requests: any[] = []; let index = 0;
  const hooks = {
    useState(initial: any) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial: any) { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); }
  };
  let response: any = { ok: false, json: async () => ({ error: 'Feedback could not be saved. Please try again.' }) };
  const module = { exports: {} as any };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, hooks, auth: { currentUser: { uid: 'account' } },
    navigator: { userAgent: 'Safari/18' }, crypto, AbortSignal, Error,
    fetch: async (...args: any[]) => { requests.push(args); return response; } });
  const props = { open: true, hidden: false, onOpen() {}, onClose() {}, section: 'Overview', isDemoMode: demo };
  let tree: any;
  const render = () => { index = 0; tree = module.exports.default(props); };
  const nodes = (): any[] => { const all: any[] = []; const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); all.push(node); walk(node.props?.children); }; walk(tree); return all; };
  const byId = (id: string) => nodes().find(n => n.props?.id === id);
  const submit = () => nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  render(); return { props, render, nodes, byId, submit, requests, text: () => JSON.stringify(tree), setResponse: (value: any) => { response = value; } };
}
const h = harness();
h.byId('feedback-message').props.onChange({ target: { value: 'Please add a weekly timetable view.' } }); h.render();
assert.equal(h.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox').props.checked, false);
await h.submit(); h.render();
assert.ok(h.text().includes('could not be saved')); assert.equal(h.byId('feedback-message').props.value, 'Please add a weekly timetable view.');
const first = JSON.parse(h.requests[0][1].body); assert.equal(first.context, undefined); assert.equal(h.requests[0][1].headers.Authorization, 'Bearer account');
h.props.open = false; h.render(); assert.ok(h.nodes().some(n => n.props['aria-label'] === 'Feedback and support'));
h.props.open = true; h.render(); assert.equal(h.byId('feedback-message').props.value, first.message, 'Closing the panel keeps the draft');
h.setResponse({ ok: true, json: async () => ({ ok: true, id: '12345678abcdef' }) });
await h.submit(); h.render();
assert.equal(JSON.parse(h.requests[1][1].body).requestId, first.requestId, 'A failed request can be retried without duplicate records');
assert.ok(h.text().includes('your feedback is saved')); assert.ok(h.text().includes('12345678'));
h.nodes().find(n => n.type === 'button' && n.props.children === 'Send another message').props.onClick(); h.render();
h.byId('feedback-category').props.onChange({ target: { value: 'bug' } }); h.render();
h.byId('feedback-message').props.onChange({ target: { value: 'The button does nothing.' } });
h.byId('feedback-steps').props.onChange({ target: { value: 'Clicked Timetable.' } });
h.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.render();
await h.submit(); h.render();
const report = JSON.parse(h.requests[2][1].body);
assert.deepEqual(report.context, { section: 'Overview', browser: 'Safari' }); assert.equal(report.steps, 'Clicked Timetable.'); assert.notEqual(report.requestId, first.requestId);
const demo = harness(true); demo.byId('feedback-message').props.onChange({ target: { value: 'Preview feedback only' } }); demo.render();
assert.equal(demo.nodes().find(n => n.type === 'button' && n.props.type === 'submit').props.disabled, true);
await demo.submit(); assert.equal(demo.requests.length, 0);
h.props.open = false; h.props.hidden = true; h.render(); assert.ok(!h.nodes().some(n => n.props['aria-label'] === 'Feedback and support'));
console.log('Feedback interactions passed: private defaults, preserved drafts, safe retries, receipt, optional context and demo restrictions.');
