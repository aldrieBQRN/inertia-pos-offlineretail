import React, { useEffect, useRef } from 'react';

/**
 * Masked PIN entry with an on-screen keypad (touch) and physical keyboard support.
 * Calls onComplete(pin) once `length` digits have been entered.
 */
export default function PinPad({ length = 4, value, onChange, onComplete, disabled = false, hasError = false }) {
    // Tracks the latest digits synchronously so fast key bursts never overwrite each other
    const valueRef = useRef(value);
    valueRef.current = value;

    // Set when a wrong PIN is shown; the first key pressed afterwards starts a fresh entry
    const freshEntryRef = useRef(false);
    useEffect(() => {
        freshEntryRef.current = hasError;
    }, [hasError]);

    const update = (next) => {
        valueRef.current = next;
        onChange(next);
    };

    const press = (digit) => {
        // After a wrong PIN, the next key starts a fresh entry (don't wait for the shake to clear)
        const current = freshEntryRef.current ? '' : valueRef.current;
        if (disabled || current.length >= length) return;
        freshEntryRef.current = false;
        const next = current + digit;
        update(next);
        if (next.length === length && onComplete) onComplete(next);
    };

    const backspace = () => {
        if (!disabled) update(valueRef.current.slice(0, -1));
    };

    const clear = () => {
        if (!disabled) update('');
    };

    // Physical keyboard / numpad / USB keypad input
    useEffect(() => {
        const handler = (e) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (/^[0-9]$/.test(e.key)) {
                e.preventDefault();
                press(e.key);
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                backspace();
            } else if (e.key === 'Escape') {
                clear();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });

    const keyClasses = "h-14 sm:h-16 rounded-none border border-gray-200 bg-white text-xl font-black text-gray-900 hover:bg-gray-50 active:bg-[#EFF4F9] active:scale-[0.97] transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs";

    return (
        <div className="space-y-6">
            {/* Masked digits */}
            <div className={`flex items-center justify-center gap-3 ${hasError ? 'animate-[shake_0.3s_ease-in-out]' : ''}`} aria-label={`${value.length} of ${length} digits entered`}>
                {Array.from({ length }).map((_, i) => (
                    <span
                        key={i}
                        className={`w-4 h-4 rounded-full border-2 transition-all ${i < value.length
                            ? (hasError ? 'bg-red-500 border-red-500' : 'bg-[#1B3B6A] border-[#1B3B6A] scale-110')
                            : 'border-gray-300 bg-white'}`}
                    />
                ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                    <button key={d} type="button" className={keyClasses} onClick={() => press(d)} disabled={disabled}>
                        {d}
                    </button>
                ))}
                <button type="button" className={`${keyClasses} text-xs uppercase tracking-widest text-gray-500`} onClick={clear} disabled={disabled}>
                    Clear
                </button>
                <button type="button" className={keyClasses} onClick={() => press('0')} disabled={disabled}>
                    0
                </button>
                <button type="button" className={`${keyClasses} flex items-center justify-center text-gray-600`} onClick={backspace} disabled={disabled} aria-label="Delete last digit">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
