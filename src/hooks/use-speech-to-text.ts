'use client';
// Ditado por voz (Web Speech API), o mesmo do Calculaqui.
import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Permissão de microfone negada. Libere o acesso nas configurações do navegador.',
  'service-not-allowed': 'Permissão de microfone negada. Libere o acesso nas configurações do navegador.',
  'no-speech': 'Não captamos nenhuma fala. Tente novamente.',
  'audio-capture': 'Nenhum microfone foi encontrado.',
  network: 'Falha de conexão com o serviço de voz.',
};

interface UseSpeechToTextOptions {
  lang?: string;
  onTranscript: (text: string) => void;
}

interface UseSpeechToTextResult {
  isSupported: boolean;
  isListening: boolean;
  interimText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useSpeechToText({ lang = 'pt-BR', onTranscript }: UseSpeechToTextOptions): UseSpeechToTextResult {
  const SpeechRecognition = getSpeechRecognition();
  const isSupported = Boolean(SpeechRecognition);

  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const manualStopRef = useRef(false);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognition) return;
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      if (finalText) {
        onTranscriptRef.current(finalText);
      }
      setInterimText(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      setError(ERROR_MESSAGES[event.error] || 'Não foi possível usar o reconhecimento de voz.');
    };

    recognition.onend = () => {
      setInterimText('');
      // Chrome encerra apos silencio; reinicia enquanto o usuario nao parou manualmente.
      if (!manualStopRef.current && recognitionRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          // ignora falhas de reinicio e encerra normalmente
        }
      }
      recognitionRef.current = null;
      setIsListening(false);
    };

    manualStopRef.current = false;
    recognitionRef.current = recognition;
    setError(null);
    setInterimText('');
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
    }
  }, [SpeechRecognition, lang]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { isSupported, isListening, interimText, error, start, stop, toggle };
}
