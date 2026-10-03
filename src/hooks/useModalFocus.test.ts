import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Exercise the real hook's DOM effects, including nested dialogs inside <main>.
class Element {
  parentElement: Element | null = null;
  children: Element[] = [];
  attributes = new Map<string, string>();
  append(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { document.activeElement = this; }
  contains(element: Element): boolean { return element === this || this.children.some(child => child.contains(element)); }
  querySelector() { return null; }
  querySelectorAll() { return this.children; }
  style = { overflow: '' };
}
const body = new Element(), root = body.append(new Element()), nav = root.append(new Element());
const main = root.append(new Element()), trigger = main.append(new Element());
const overlay = root.append(new Element()), dialog = overlay.append(new Element());
const first = dialog.append(new Element()), last = dialog.append(new Element());
const document = { body, activeElement: trigger };
const handlers = new Set<(event: any) => void>(), timers = new Map<number, () => void>();
let observerCallback: () => void = () => {}, disconnected = false, timerId = 0;
const bundle = await build({ entryPoints: ['src/hooks/useModalFocus.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'hooks', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const {useRef,useEffect}=globalThis.hooks; export default globalThis.hooks;' }));
  } }] });
const effects: Array<() => void | (() => void)> = [], refs: any[] = [];
const hooks = { useRef: (initial: any) => { const ref = { current: initial }; refs.push(ref); return ref; },
  useEffect: (fn: () => void) => effects.push(fn) };
const module = { exports: {} as any };
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, hooks, document,
  window: { addEventListener: (_: string, fn: any) => handlers.add(fn), removeEventListener: (_: string, fn: any) => handlers.delete(fn) },
  MutationObserver: class { constructor(fn: () => void) { observerCallback = fn; } observe() {} disconnect() { disconnected = true; } },
  setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id) });
function open(element: Element, onClose = () => {}) {
  const hook = module.exports.useModalFocus({ onClose }); hook.modalRef.current = element;
  const close = effects.pop()!() as () => void;
  return { hook, close };
}
nav.setAttribute('aria-hidden', 'false');
const outer = open(dialog);
assert.equal(main.getAttribute('aria-hidden'), 'true'); assert.equal(main.getAttribute('inert'), '');
assert.equal(nav.getAttribute('inert'), ''); assert.equal(dialog.getAttribute('aria-hidden'), null);
assert.equal(document.activeElement, dialog);
for (const fn of timers.values()) fn(); timers.clear(); assert.equal(document.activeElement, first);
function key(key: string, shiftKey = false) {
  let prevented = false;
  for (const fn of handlers) fn({ key, shiftKey, preventDefault() { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  return prevented;
}
last.focus(); assert.equal(key('Tab'), true); assert.equal(document.activeElement, first);
assert.equal(key('Tab', true), true); assert.equal(document.activeElement, last);
const lateBackground = root.append(new Element()); observerCallback(); assert.equal(lateBackground.getAttribute('inert'), '');
let nestedEscapes = 0;
const nested = dialog.append(new Element()), nestedControl = nested.append(new Element());
const inner = open(nested, () => nestedEscapes++);
assert.equal(first.getAttribute('inert'), ''); assert.equal(nested.getAttribute('inert'), null);
assert.equal(key('Escape'), true); assert.equal(nestedEscapes, 1);
inner.close(); assert.equal(first.getAttribute('inert'), null); assert.equal(main.getAttribute('inert'), '');
assert.equal(document.activeElement, last);
outer.close(); assert.equal(main.getAttribute('aria-hidden'), null); assert.equal(nav.getAttribute('aria-hidden'), 'false');
assert.equal(lateBackground.getAttribute('inert'), null); assert.equal(document.activeElement, trigger); assert.equal(disconnected, true);
assert.equal(body.style.overflow, ''); assert.equal(handlers.size, 0);
// A dialog rendered by a tab inside <main> keeps its ancestors usable and hides siblings.
const tabDialog = main.append(new Element());
const local = open(tabDialog);
assert.equal(main.getAttribute('aria-hidden'), null); assert.equal(trigger.getAttribute('inert'), '');
assert.equal(nav.getAttribute('inert'), ''); assert.equal(tabDialog.getAttribute('inert'), null);
local.close(); assert.equal(trigger.getAttribute('inert'), null);
console.log('Modal background isolation, late content, nesting, Tab/Escape and focus/attribute restoration passed.');
