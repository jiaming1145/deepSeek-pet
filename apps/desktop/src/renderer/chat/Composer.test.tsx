// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps, type SendResult } from './Composer';

// vitest runs with `globals: false`, so @testing-library/react cannot find a global `afterEach`
// to register its auto-cleanup on. Without this the previous test's tree stays in document.body
// and `getByRole('textbox')` finds two textareas from the second test onwards.
afterEach(cleanup);

function props(over: Partial<ComposerProps> = {}): ComposerProps {
  return {
    onSend: vi.fn(async () => ({ ok: true as const, turnId: 't-1' })),
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onComposingChange: vi.fn(),
    onCompleteSpeech: vi.fn(),
    onRowsChange: vi.fn(),
    onToggleHistory: vi.fn(),
    historyOpen: false,
    brainState: 'idle',
    turnDone: null,
    turnError: null,
    ...over,
  };
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Composer', () => {
  it('does not send while the IME is composing', () => {
    const p = props();
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox');
    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: 'ni hao' } });
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(p.onSend).not.toHaveBeenCalled();
    expect(p.onComposingChange).toHaveBeenCalledWith(true);
  });

  it('swallows the trailing keydown some IMEs deliver after compositionend', () => {
    const p = props();
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox');
    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: '你好' } });
    fireEvent.compositionEnd(ta);
    fireEvent.keyDown(ta, { key: 'Enter' }); // same macrotask -> still swallowed
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it('sends on Enter once composition ends', async () => {
    const p = props();
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox');
    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: '你好' } });
    fireEvent.compositionEnd(ta);
    await tick();
    fireEvent.keyDown(ta, { key: 'Enter' });
    await tick();
    expect(p.onSend).toHaveBeenCalledTimes(1);
    expect(p.onSend).toHaveBeenCalledWith('你好');
    expect((ta as HTMLTextAreaElement).value).toBe('');
  });

  it('inserts a newline on Shift+Enter and does not send', () => {
    const p = props();
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '第一行' } });
    const notPrevented = fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(notPrevented).toBe(true); // default (newline) left alone
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it('caps auto-grow at 6 rows', () => {
    const p = props();
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'a\nb\nc\nd\ne\nf\ng\nh' } });
    expect(ta.rows).toBe(6);
    expect(p.onRowsChange).toHaveBeenLastCalledWith(6);
  });

  it('completes the reveal when Enter is pressed on an empty composer', () => {
    const p = props();
    render(<Composer {...p} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(p.onCompleteSpeech).toHaveBeenCalledTimes(1);
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it('restores the text when the turn errors', async () => {
    const p = props();
    const { rerender } = render(<Composer {...p} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '今天面试完了' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await tick();
    expect(ta.value).toBe('');
    rerender(<Composer {...p} turnError={{ turnId: 't-1', code: 'network', message: 'x', n: 1 }} />);
    expect(ta.value).toBe('今天面试完了');
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe('今天面试完了'.length);
  });

  it('restores the text immediately when the send itself is rejected', async () => {
    const p = props({ onSend: vi.fn(async () => ({ ok: false as const, code: 'no-key' as const, message: '还没填 API Key' })) });
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '在吗' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await tick();
    expect(ta.value).toBe('在吗');
    expect(document.activeElement).toBe(ta);
  });

  it('drops the pending text once the turn finishes', async () => {
    const p = props();
    const { rerender } = render(<Composer {...p} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '晚安' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await tick();
    rerender(<Composer {...p} turnDone={{ turnId: 't-1', n: 1 }} />);
    rerender(<Composer {...p} turnDone={{ turnId: 't-1', n: 1 }} turnError={{ turnId: 't-1', code: 'network', message: 'x', n: 2 }} />);
    expect(ta.value).toBe('');
  });

  it('cancels instead of closing when Escape is pressed while she is speaking', () => {
    const p = props({ brainState: 'speaking' });
    render(<Composer {...p} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('shows the state line and closes on Escape when idle', () => {
    const p = props();
    const { rerender } = render(<Composer {...p} />);
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<Composer {...p} brainState="thinking" />);
    expect(screen.getByRole('status').textContent).toBe('她在想…');
    rerender(<Composer {...p} brainState="speaking" />);
    expect(screen.getByRole('status').textContent).toBe('她在说…');
    rerender(<Composer {...p} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, finding 4. restore() used to key its focus/select effect on `value`; when the
  // restored text equalled what the user had already retyped, React bailed out of the re-render,
  // the effect never ran, and restoreRef stayed loaded so the NEXT keystroke fired a stale
  // setSelectionRange over freshly typed text.
  it('restores and selects even when the retyped text equals the restored text', async () => {
    let settle: (r: SendResult) => void = () => {};
    const p = props({
      onSend: vi.fn(
        () =>
          new Promise<SendResult>((res) => {
            settle = res;
          }),
      ),
    });
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '在吗' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await tick();
    expect(ta.value).toBe('');
    // The user retypes the same two characters while the send is still in flight.
    fireEvent.change(ta, { target: { value: '在吗' } });
    await act(async () => {
      settle({ ok: false, code: 'no-key', message: '还没填 API Key' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ta.value).toBe('在吗');
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe(2);
  });

  // Fix round 1, finding 3. Pins the polarity: focus/blur are the UNLATCH (2.3's recovery rule),
  // and compositionstart is the only thing that arms the guard — which is also the only thing that
  // now raises main's `avatar:listening` pose (6.6, narrowed by the fix-round-1 amendment).
  it('unlatches on focus and blur; only compositionstart arms the guard', () => {
    const p = props();
    render(<Composer {...p} />);
    const ta = screen.getByRole('textbox');
    vi.mocked(p.onComposingChange).mockClear(); // autoFocus has already fired one unlatch
    fireEvent.focus(ta);
    fireEvent.blur(ta);
    expect(p.onComposingChange).toHaveBeenCalledTimes(2);
    expect(p.onComposingChange).toHaveBeenNthCalledWith(1, false);
    expect(p.onComposingChange).toHaveBeenNthCalledWith(2, false);
    fireEvent.compositionStart(ta);
    expect(p.onComposingChange).toHaveBeenLastCalledWith(true);
  });
});
