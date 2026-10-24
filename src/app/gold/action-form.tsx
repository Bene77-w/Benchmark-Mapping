"use client";

import { type ReactNode, useActionState } from "react";
import type { ActionState } from "./actions";

/** Formular für eine Server Action mit Fehler- bzw. Erfolgsmeldung. */
export function ActionForm({
  action,
  children,
  className,
  testId,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <form action={formAction} className={className} data-testid={testId}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {!state.error && state.message && (
        <output className="block text-sm text-muted-foreground">{state.message}</output>
      )}
    </form>
  );
}
