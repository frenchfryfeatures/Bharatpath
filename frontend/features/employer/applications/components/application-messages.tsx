"use client";

import { useState, type FormEvent } from "react";
import { MessageSquareText } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { AppSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";
import {
  useGetEmployerMessagesQuery,
  useSendEmployerMessageMutation,
} from "@/store/employer/applications/applications.api";

type MessageKind = "INTERVIEW" | "ASSESSMENT" | "GENERAL";

const messageKinds = [
  { value: "INTERVIEW", label: "Interview invitation" },
  { value: "ASSESSMENT", label: "Online assessment" },
  { value: "GENERAL", label: "General message" },
];

const fieldClass =
  "mt-1.5 h-10 w-full rounded-lg border border-[#dfe3e9] bg-white px-3 text-[12px] font-normal normal-case tracking-normal text-[#151b2b] outline-none placeholder:text-[#a1a8b3] focus:border-[#315f9b] focus:ring-2 focus:ring-[#315f9b]/10";
const labelClass =
  "block text-[11px] font-bold uppercase tracking-[0.06em] text-[#687384]";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ApplicationMessages({ applicationId }: { applicationId: string }) {
  const messages = useGetEmployerMessagesQuery(applicationId);
  const [send, sending] = useSendEmployerMessageMutation();
  const [kind, setKind] = useState<MessageKind>("INTERVIEW");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [link, setLink] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ body?: string; when?: string; link?: string }>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = {
      body: !body.trim() ? "Write a message before sending." : undefined,
      when: kind === "INTERVIEW" && !when ? "Choose the interview date and time."
        : when && Number.isNaN(new Date(when).getTime()) ? "Choose a valid date and time." : undefined,
      link: kind === "ASSESSMENT" && !link.trim() ? "Enter the assessment link."
        : link.trim() && !/^https:\/\/\S+$/i.test(link.trim()) ? "Use a secure link beginning with https://." : undefined,
    };
    setFieldErrors(errors);
    if (errors.body || errors.when || errors.link) {
      showFormError("Check the highlighted message fields.", { portal: "employer", container: event.currentTarget });
      return;
    }

    try {
      await send({
        applicationId,
        kind,
        body: body.trim(),
        scheduled_at: kind !== "GENERAL" && when ? new Date(when).toISOString() : undefined,
        link: kind !== "GENERAL" && link.trim() ? link.trim() : undefined,
      }).unwrap();
      setBody("");
      setWhen("");
      setLink("");
    } catch (error) {
      showFormError(getApiErrorMessage(error, "Message could not be sent. Check the schedule and link, then try again."), { portal: "employer" });
    }
  }

  return (
    <section className="border-t border-[#e7e9ee] pt-5 text-[#151b2b]">
      <div className="flex items-center gap-2">
        <MessageSquareText size={17} className="text-[#315f9b]" />
        <h3 className="text-[13px] font-bold text-[#151b2b]">Messages to candidate</h3>
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-[#687384]">
        The platform sends your message by email and in-app notification.
      </p>

      <div className="mt-4 max-h-48 space-y-2 overflow-y-auto" aria-label="Messages sent to this candidate">
        {messages.isLoading ? (
          <><Skeleton width="100%" height={64} /><Skeleton width="100%" height={64} /></>
        ) : messages.error ? (
          <p className="rounded-lg border border-[#e7e9ee] bg-[#f8f9fb] p-3 text-[12px] text-[#687384]">
            Message history could not be loaded.
          </p>
        ) : messages.data?.length ? (
          messages.data.map((message) => (
            <div key={message.id} className="rounded-lg border border-[#e7e9ee] bg-[#f8f9fb] p-3">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-[11px] font-bold text-[#315f9b]">
                  {message.kind === "INTERVIEW" ? "Interview" : message.kind === "ASSESSMENT" ? "Assessment" : "General"}
                </span>
                <span className="text-[11px] text-[#7b8494]">{formatDateTime(message.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#344054]">{message.body}</p>
              {message.scheduled_at && <p className="mt-1 text-[11px] text-[#687384]">Scheduled: {formatDateTime(message.scheduled_at)}</p>}
              {message.link && <a href={message.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-semibold text-[#315f9b] hover:underline">Open link</a>}
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-[#dfe3e9] bg-[#fbfcfe] px-3 py-4 text-[12px] text-[#7b8494]">
            No messages sent yet.
          </p>
        )}
      </div>

      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        <div>
          <span className={labelClass}>Message type</span>
          <AppSelect
            value={kind}
            onChange={(value) => setKind(value as MessageKind)}
            options={messageKinds}
            ariaLabel="Message type"
            className="mt-1.5"
          />
        </div>

        <label className={labelClass}>
          Message
          <textarea
            value={body}
            aria-invalid={Boolean(fieldErrors.body)}
            aria-describedby={fieldErrors.body ? "application-message-body-error" : undefined}
            onChange={(event) => { setBody(event.target.value); setFieldErrors((current) => ({ ...current, body: undefined })); }}
            minLength={1}
            maxLength={2000}
            required
            rows={4}
            placeholder="Write a message for the candidate"
            className={`${fieldClass} h-auto min-h-24 resize-y py-2.5 font-normal normal-case tracking-normal ${fieldErrors.body ? "!border-[#c92f3f]" : ""}`}
          />
          {fieldErrors.body && <span id="application-message-body-error" className="mt-1 text-[12px] text-[#c92f3f]">{fieldErrors.body}</span>}
        </label>

        {kind !== "GENERAL" && (
          <>
            <div>
              <label htmlFor="application-message-time" className={labelClass}>
                {kind === "INTERVIEW" ? "Interview time" : "Assessment deadline (optional)"}
              </label>
              <DateTimePicker
                id="application-message-time"
                value={when}
                onChange={(value) => { setWhen(value); setFieldErrors((current) => ({ ...current, when: undefined })); }}
                required={kind === "INTERVIEW"}
                invalid={Boolean(fieldErrors.when)}
                ariaDescribedBy={fieldErrors.when ? "application-message-time-error" : undefined}
                className={`${fieldClass} mt-1.5 ${fieldErrors.when ? "!border-[#c92f3f]" : ""}`}
              />
              {fieldErrors.when && <p id="application-message-time-error" className="mt-1 text-[12px] text-[#c92f3f]">{fieldErrors.when}</p>}
            </div>
            <label className={labelClass}>
              {kind === "INTERVIEW" ? "Meeting link (optional)" : "Assessment link"}
              <input
                type="url"
                value={link}
                aria-invalid={Boolean(fieldErrors.link)}
                aria-describedby={fieldErrors.link ? "application-message-link-error" : undefined}
                onChange={(event) => { setLink(event.target.value); setFieldErrors((current) => ({ ...current, link: undefined })); }}
                required={kind === "ASSESSMENT"}
                pattern="https://.*"
                placeholder="https://..."
                className={`${fieldClass} ${fieldErrors.link ? "!border-[#c92f3f]" : ""}`}
              />
              {fieldErrors.link && <span id="application-message-link-error" className="mt-1 text-[12px] text-[#c92f3f]">{fieldErrors.link}</span>}
            </label>
          </>
        )}

        <Button type="submit" variant="primary" size="md" isLoading={sending.isLoading}>
          Send message
        </Button>
      </form>
    </section>
  );
}
