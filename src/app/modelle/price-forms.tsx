"use client";

import { type ReactNode, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type SavePriceState, saveModelPriceAction, saveWebSearchPriceAction } from "./actions";

const initialState: SavePriceState = { error: null, saved: null };
const selectClass = "h-8 rounded-lg border bg-background px-2 text-sm";

export interface ModelPriceDefaults {
  modelId: string;
  validFrom: string;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
}

/** Preis anlegen oder ändern; gleiches Modell und Gültig-ab-Datum überschreibt den bestehenden Preis. */
export function ModelPriceForm({ defaults, modelIds }: { defaults: ModelPriceDefaults; modelIds: string[] }) {
  const [state, action, pending] = useActionState(saveModelPriceAction, initialState);
  return (
    <form action={action} className="space-y-3" data-testid="model-price-form">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Field id="price-model" label="Modell-ID" className="col-span-2">
          <Input
            id="price-model"
            name="modelId"
            required
            list="price-model-ids"
            defaultValue={defaults.modelId}
            placeholder="z. B. claude-haiku-5-5"
          />
          <datalist id="price-model-ids">
            {modelIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>
        <Field id="price-valid-from" label="Gültig ab" className="col-span-2">
          <Input
            id="price-valid-from"
            name="validFrom"
            type="date"
            required
            defaultValue={defaults.validFrom}
          />
        </Field>
        <div className="hidden sm:col-span-2 sm:block" />
        <PriceField id="price-input" name="input" label="Input" value={defaults.input} required />
        <PriceField id="price-cache-read" name="cacheRead" label="Cache-Read" value={defaults.cacheRead} />
        <PriceField
          id="price-cache-write"
          name="cacheWrite"
          label="Cache-Write"
          value={defaults.cacheWrite}
        />
        <PriceField id="price-output" name="output" label="Output" value={defaults.output} required />
      </div>
      <p className="text-sm text-muted-foreground">
        USD pro Million Tokens zum API-Listenpreis. Output gilt auch für Reasoning-Tokens. Leere Cache-Felder
        = kein Tarif; fallen Cache-Tokens an, sind die Kosten dann „unbekannt“. Gleiches Modell und Datum
        überschreibt den bestehenden Preis, ein neues Datum ergänzt die Historie.
      </p>
      <FormStatus state={state} />
      <Button type="submit" disabled={pending}>
        Preis speichern
      </Button>
    </form>
  );
}

/** Websuchpreis je Harness anlegen oder ändern. */
export function WebSearchPriceForm({ harnesses }: { harnesses: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(saveWebSearchPriceAction, initialState);
  return (
    <form action={action} className="space-y-3" data-testid="web-search-price-form">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          Harness
          <select name="harness" className={selectClass}>
            {harnesses.map((harness) => (
              <option key={harness.value} value={harness.value}>
                {harness.label}
              </option>
            ))}
          </select>
        </label>
        <Field id="search-valid-from" label="Gültig ab" className="col-span-2">
          <Input id="search-valid-from" name="validFrom" type="date" required />
        </Field>
        <Field id="search-price" label="USD pro Suche" className="col-span-2">
          <Input id="search-price" name="perSearch" type="number" step="any" min={0} required />
        </Field>
      </div>
      <FormStatus state={state} />
      <Button type="submit" disabled={pending}>
        Websuchpreis speichern
      </Button>
    </form>
  );
}

function PriceField({
  id,
  name,
  label,
  value,
  required = false,
}: {
  id: string;
  name: string;
  label: string;
  value: number | null;
  required?: boolean;
}) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        name={name}
        type="number"
        step="any"
        min={0}
        required={required}
        defaultValue={value ?? ""}
      />
    </Field>
  );
}

function FormStatus({ state }: { state: SavePriceState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  return <output className="block text-sm text-muted-foreground">{state.saved}</output>;
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 text-sm ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
