"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MessageCircle, Volume2, VolumeX } from "lucide-react";
import type { ConversationAnswer } from "./conversation-questions";

/** Scripted questions; speech is opt-in and uses the browser's own voice. */
export function ConversationPrompt({ question, thinking, history, onEdit, disabled, children, retryMessage, attempts = [] }: {
  question: string;
  thinking: boolean;
  history: ConversationAnswer[];
  onEdit: (answer: ConversationAnswer) => void;
  disabled: boolean;
  children: ReactNode;
  retryMessage: string;
  /** Answers refused for the current question, replayed as chat turns. */
  attempts?: { answer: string; message: string }[];
}) {
  const [streamed, setStreamed] = useState({ question: "", text: "" });
  const [voice, setVoice] = useState(false);
  const supported = useSyncExternalStore(subscribeToSupport, getSpeechSupport, () => false);
  const promptRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [typedAttempts, setTypedAttempts] = useState(0);
  useEffect(() => {
    if (attempts.length) return;
    const timer = setTimeout(() => setTypedAttempts(0), 0);
    return () => clearTimeout(timer);
  }, [attempts.length]);
  const followTyping = () => { const chat = scrollRef.current; if (chat) chat.scrollTop = chat.scrollHeight; };
  useEffect(() => {
    const chat = scrollRef.current;
    chat?.scrollTo({ top: chat.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [history.length, attempts.length, thinking, question, streamed.text]);

  useEffect(() => {
    if (thinking) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let streaming = false;
    const setText = (text: string) => { if (!disposed) setStreamed({ question, text }); };
    const stream = () => {
      if (disposed || streaming) return;
      streaming = true;
      let cursor = 0;
      timer = setInterval(() => {
        cursor += 3;
        setText(question.slice(0, cursor));
        if (cursor >= question.length) clearInterval(timer);
      }, 25);
    };
    promptRef.current?.focus({ preventScroll: true });
    if (voice && supported) {
      const utterance = new SpeechSynthesisUtterance(question);
      utterance.lang = "en-IN";
      utterance.rate = 0.95;
      utterance.onstart = () => {
        if (fallback) clearTimeout(fallback);
        stream();
      };
      utterance.onboundary = (event) => {
        if (event.name === "word") {
          clearInterval(timer);
          setText(question.slice(0, event.charIndex + (event.charLength || 1)));
        }
      };
      utterance.onend = () => { clearInterval(timer); setText(question); };
      utterance.onerror = () => { stream(); };
      window.speechSynthesis.speak(utterance);
      fallback = setTimeout(stream, 1500);
    } else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fallback = setTimeout(() => setText(question), 0);
    } else stream();
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(fallback);
      if (voice && supported) window.speechSynthesis.cancel();
    };
  }, [question, thinking, voice, supported]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#C9BEEB] bg-[#F8F5FF]">
    <div className="flex items-center gap-3 border-b border-[#E7DFF5] bg-white px-5 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#5F4DB2] text-white"><MessageCircle size={20} aria-hidden="true" /></span>
      <div><p className="font-semibold text-[#0A1931]">Your BharatPath guide</p><p className="text-xs text-[#5F6B80]">Let&apos;s build your profile, one answer at a time.</p></div>
    </div>
    <div className="flex items-center justify-end gap-3 px-5 pt-4">
        {supported && <button type="button" onClick={() => setVoice(!voice)} aria-pressed={voice} className="flex items-center gap-2 text-xs text-[#5F4DB2]">
          {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}{voice ? "Voice on" : "Enable voice"}
        </button>}
      </div>
    <div ref={scrollRef} role="log" aria-label="Conversation" className="relative min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-color:#C9BEEB_transparent] [scrollbar-width:thin]">
    {history.length > 0 && <ol className="space-y-4" aria-label="Conversation history">
      {history.map((answer) => <li key={answer.key} className="chat-in space-y-2">
        <p className="mr-8 rounded-2xl rounded-tl-sm bg-white p-3 text-sm text-[#3A4761]">{answer.question}</p>
        <div className="ml-8 flex items-center justify-end gap-2">
          <button type="button" disabled={disabled} onClick={() => onEdit(answer)} aria-label={`Edit answer: ${answer.answer}`} className="text-xs text-[#5F4DB2] underline disabled:opacity-50">Edit</button>
          <p className="max-w-[85%] break-words rounded-2xl rounded-tr-sm bg-[#5F4DB2] px-4 py-3 text-sm text-white">{answer.answer}</p>
        </div>
      </li>)}
    </ol>}
      {thinking ? <p role="status" className="flex items-center gap-3 text-[#5F4DB2]">
        <span className="thinking-pulse h-3 w-3 shrink-0 rounded-full bg-[#5F4DB2]" aria-hidden="true" /> Thinking about your next question…
      </p> : <><p aria-hidden="true" className="min-h-14 rounded-2xl rounded-tl-sm bg-white p-4 text-base font-medium leading-7 text-[#0A1931]">{streamed.question === question ? streamed.text : ""}</p><p className="sr-only" aria-live="polite">{question}</p></>}
      {/* Each refused answer is a turn: what was typed, why it was refused, the question again. */}
      {!thinking && attempts.map((attempt, index) => {
        const latest = index === attempts.length - 1;
        const errorTyped = !latest || typedAttempts >= attempts.length;
        return <div key={index} className="mt-3 space-y-3">
          <div className="chat-in flex justify-end"><p className="max-w-[85%] break-words rounded-2xl rounded-tr-sm bg-[#5F4DB2] px-4 py-3 text-sm text-white">{attempt.answer || "(no answer)"}</p></div>
          <p style={{ animationDelay: "350ms" }} role={latest ? "alert" : undefined} id={latest ? "conversation-retry" : undefined} className="chat-in rounded-2xl rounded-tl-sm bg-white p-4 text-sm leading-6 text-[#9A3B42]">
            <Typewriter text={attempt.message} animate={latest} startDelay={350} onTick={followTyping} onDone={() => setTypedAttempts((count) => Math.max(count, index + 1))} />
          </p>
          {errorTyped && <p className="chat-in rounded-2xl rounded-tl-sm bg-white p-4 text-base font-medium leading-7 text-[#0A1931]">
            <Typewriter text={question} animate={latest} onTick={followTyping} />
          </p>}
        </div>;
      })}
      {retryMessage && !attempts.length && !thinking && <p id="conversation-retry" role="alert" className="mt-3 rounded-2xl rounded-tl-sm bg-white p-4 text-sm leading-6 text-[#9A3B42]">{retryMessage}</p>}
    </div>
    <div ref={promptRef} tabIndex={-1} className="max-h-[45dvh] overflow-y-auto border-t border-[#E7DFF5] p-5 outline-none">
      {children}
      <style jsx>{`
        .chat-in { opacity: 0; animation: onboarding-chat-in 380ms ease-out forwards; }
        @keyframes onboarding-chat-in {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .thinking-pulse { animation: onboarding-thinking-pulse 1.2s ease-in-out infinite; }
        @keyframes onboarding-thinking-pulse {
          0%, 45%, 100% { transform: scale(1); opacity: 0.65; box-shadow: 0 0 0 0 rgba(95, 77, 178, 0); }
          15%, 35% { transform: scale(1.25); opacity: 1; box-shadow: 0 0 0 5px rgba(95, 77, 178, 0.12); }
          25% { transform: scale(1.05); opacity: 0.8; box-shadow: 0 0 0 2px rgba(95, 77, 178, 0.06); }
        }
        @media (prefers-reduced-motion: reduce) { .thinking-pulse { animation: none; } .chat-in { animation: none; opacity: 1; } }
      `}</style>
    </div>
    </section>
  );
}

function subscribeToSupport() { return () => {}; }
function getSpeechSupport() { return "speechSynthesis" in window; }

/** Types `text` out in the chat; shows it whole when not animating or when motion is reduced. */
function Typewriter({ text, animate = true, startDelay = 0, onTick, onDone }: {
  text: string; animate?: boolean; startDelay?: number; onTick?: () => void; onDone?: () => void;
}) {
  const [count, setCount] = useState(0);
  const callbacks = useRef({ onTick, onDone });
  useEffect(() => { callbacks.current = { onTick, onDone }; }, [onTick, onDone]);
  useEffect(() => {
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = setTimeout(() => {
        setCount(text.length);
        callbacks.current.onDone?.();
      }, 0);
      return () => clearTimeout(timer);
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      let cursor = 0;
      timer = setInterval(() => {
        cursor += 2;
        setCount(cursor);
        callbacks.current.onTick?.();
        if (cursor >= text.length) { clearInterval(timer); callbacks.current.onDone?.(); }
      }, 22);
    }, startDelay);
    return () => { clearTimeout(start); clearInterval(timer); };
  }, [text, animate, startDelay]);
  return <><span aria-hidden="true">{text.slice(0, count)}</span><span className="sr-only">{text}</span></>;
}
