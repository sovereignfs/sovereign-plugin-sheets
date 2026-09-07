/**
 * Minimal DOM test harness — React 19's `act` plus native event dispatch,
 * so the component tests need nothing beyond react-dom and jsdom (Testing
 * Library isn't a dependency of this plugin). Events are dispatched as
 * real DOM events at the element, which React's root listener picks up
 * exactly as it would in a browser.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider } from '@sovereignfs/ui';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export function installBrowserStubs() {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
  // jsdom has the element but not the modal API the design system's Dialog uses.
  const dialogProto = (globalThis as { HTMLDialogElement?: { prototype: HTMLDialogElement } }).HTMLDialogElement
    ?.prototype;
  if (dialogProto && typeof dialogProto.showModal !== 'function') {
    dialogProto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    dialogProto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
}

export interface Mounted {
  container: HTMLElement;
  root: Root;
  rerender: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
  $: <T extends Element = HTMLElement>(selector: string) => T;
  $$: <T extends Element = HTMLElement>(selector: string) => T[];
}

export async function mount(node: ReactNode): Promise<Mounted> {
  installBrowserStubs();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (next: ReactNode) => {
    await act(async () => {
      root.render(<ToastProvider>{next}</ToastProvider>);
    });
  };
  await render(node);
  return {
    container,
    root,
    rerender: render,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
    $: <T extends Element = HTMLElement>(selector: string) => {
      const el = container.querySelector<T>(selector);
      if (!el) throw new Error(`No element matches ${selector}`);
      return el;
    },
    $$: <T extends Element = HTMLElement>(selector: string) => Array.from(container.querySelectorAll<T>(selector)),
  };
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function fireKey(
  el: Element,
  key: string,
  init: Partial<KeyboardEventInit> = {},
): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

export async function fireMouseDown(el: Element, init: Partial<MouseEventInit> = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }));
  });
}

export async function fireDoubleClick(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

export async function focusEl(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
}

export async function blurEl(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.blur();
  });
}

/** Sets a controlled input/textarea's value the way a user typing would (native setter + `input` event). */
export async function typeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function firePaste(el: Element, text: string): Promise<void> {
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : ''), setData: () => {} },
    });
    el.dispatchEvent(event);
  });
}
