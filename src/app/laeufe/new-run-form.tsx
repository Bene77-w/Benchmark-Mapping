"use client";

import { type ReactNode, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type StartRunState, startRun } from "./actions";

export interface HarnessOption {
  value: string;
  label: string;
}

const selectClass = "h-8 rounded-lg border bg-background px-2 text-sm";

export function NewRunForm({
  harnesses,
  defaults,
}: {
  harnesses: HarnessOption[];
  defaults: { parallelism: number; timeoutMinutes: number; minParallelism: number; maxParallelism: number };
}) {
  const [state, action, pending] = useActionState<StartRunState, FormData>(startRun, { error: null });
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Harness
          <select name="harness" className={selectClass}>
            {harnesses.map((harness) => (
              <option key={harness.value} value={harness.value}>
                {harness.label}
              </option>
            ))}
          </select>
        </label>
        <Field id="run-model" label="Modell">
          <Input id="run-model" name="model" required placeholder="z. B. standard" />
        </Field>
        <Field id="run-effort" label="Effort">
          <Input id="run-effort" name="effort" required placeholder="z. B. high" />
        </Field>
        <label className="flex flex-col gap-1 text-sm">
          Modus
          <select name="mode" className={selectClass} defaultValue="text_only">
            <option value="text_only">nur Zuständigkeitstext</option>
            <option value="web">mit Websuche</option>
          </select>
        </label>
        <Field id="run-parallelism" label="Parallelität">
          <Input
            id="run-parallelism"
            name="parallelism"
            type="number"
            min={defaults.minParallelism}
            max={defaults.maxParallelism}
            defaultValue={defaults.parallelism}
            required
          />
        </Field>
        <Field id="run-timeout" label="Timeout pro Unit (Minuten)">
          <Input
            id="run-timeout"
            name="timeoutMinutes"
            type="number"
            min={1}
            defaultValue={defaults.timeoutMinutes}
            required
          />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">
        Beim Fake-Harness ist das Modell der Name eines Szenarios unter{" "}
        <code>tests/fixtures/fake-harness/</code> (z. B. <code>standard</code>).
      </p>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        Lauf starten
      </Button>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
