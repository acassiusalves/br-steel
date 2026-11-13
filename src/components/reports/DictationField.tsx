'use client';
import { useCallback } from 'react';
import { Mic, Square } from 'lucide-react';
import { useSpeechToText } from '@/hooks/use-speech-to-text';

interface DictationFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  id?: string;
}

function appendTranscript(current: string, addition: string) {
  const trimmed = addition.trim();
  if (!trimmed) return current;
  if (!current) return trimmed;
  return `${current}${/\s$/.test(current) ? '' : ' '}${trimmed}`;
}

/** Campo de texto com ditado por voz, como no Calculaqui. */
export default function DictationField({ value, onChange, disabled = false, rows = 5, placeholder, className = '', id }: DictationFieldProps) {
  const handleTranscript = useCallback((text: string) => onChange(appendTranscript(value, text)), [onChange, value]);
  const { isSupported, isListening, interimText, error, toggle } = useSpeechToText({ onTranscript: handleTranscript });

  return (
    <div>
      <div className="relative">
        <textarea
          id={id}
          value={value}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
          rows={rows}
          placeholder={placeholder}
          className={`w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-60 ${isSupported ? 'pr-12' : ''} ${className}`}
        />
        {isSupported && (
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-pressed={isListening}
            aria-label={isListening ? 'Parar ditado por voz' : 'Ditar por voz'}
            title={isListening ? 'Parar ditado por voz' : 'Ditar por voz'}
            className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-50 ${isListening
              ? 'animate-pulse border-red-200 bg-red-600 text-white shadow-sm'
              : 'border-zinc-200 bg-white text-zinc-500 hover:border-primary/30 hover:text-primary'}`}
          >
            {isListening ? <Square size={14} className="fill-current" /> : <Mic size={16} />}
          </button>
        )}
      </div>
      {isListening && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" />
          Ouvindo... fale a descrição{interimText ? `: ${interimText}` : '.'}
        </p>
      )}
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
