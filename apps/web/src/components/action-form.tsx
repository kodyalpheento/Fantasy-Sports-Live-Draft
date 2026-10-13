'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export interface ActionResult {
  error?: string;
  ok?: string;
}

export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

export function SubmitButton({ children, className = 'btn-primary', pendingLabel, confirm }: { children: ReactNode; className?: string; pendingLabel?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel ?? 'Working…' : children}
    </button>
  );
}

/** A form bound to a server action that shows the action's error / success message inline. */
export function ActionForm({
  action, children, submitLabel, submitClassName, className = 'space-y-4', confirm, inline = false,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel?: ReactNode;
  submitClassName?: string;
  className?: string;
  confirm?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={inline ? 'inline-flex items-center gap-2' : className}>
      {children}
      {submitLabel && <SubmitButton className={submitClassName} confirm={confirm}>{submitLabel}</SubmitButton>}
      {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
