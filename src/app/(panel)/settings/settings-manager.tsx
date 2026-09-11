"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  FormField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextInput,
} from "@/components/ui";
import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import type { PresentedSetting } from "@/lib/runtime-settings";

interface SettingsManagerProps {
  readonly settings: readonly PresentedSetting[];
  readonly updateAction: AuthorizationChangeAction;
}

const BUTTON =
  "rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-brand text-white hover:bg-brand-strong`;

export function SettingsManager({ settings, updateAction }: SettingsManagerProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Etkin değer tablodaki satırdır; satır yoksa varsayılan uygulanır. Değişiklik hemen, yeniden
        başlatmadan geçer.
      </p>

      <Table caption="Çalışma zamanı ayarları">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Anahtar</TableHeaderCell>
            <TableHeaderCell>Etkin değer</TableHeaderCell>
            <TableHeaderCell>Varsayılan</TableHeaderCell>
            <TableHeaderCell>Açıklama</TableHeaderCell>
            <TableHeaderCell>Güncelle</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {settings.map((setting) => (
            <SettingRow key={setting.key} setting={setting} action={updateAction} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SettingRow({
  setting,
  action,
}: {
  readonly setting: PresentedSetting;
  readonly action: AuthorizationChangeAction;
}) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );
  const submitting = useRef(false);
  const prefix = `setting-${setting.key.replaceAll(".", "-")}`;
  const defaultLabel = setting.defaultValue === "" ? EMPTY_VALUE : setting.defaultValue;
  const effectiveLabel = setting.effectiveValue === "" ? EMPTY_VALUE : setting.effectiveValue;

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-xs break-all">{setting.key}</span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-sm">{effectiveLabel}</span>
        {setting.updatedAt === null ? null : (
          <span className="mt-1 block text-xs text-ink-subtle">
            {formatDateTime(setting.updatedAt)}
          </span>
        )}
      </TableCell>
      <TableCell>
        <span className="font-mono text-sm text-ink-muted">{defaultLabel}</span>
      </TableCell>
      <TableCell>
        <span className="max-w-72 text-sm text-ink-muted">{setting.description}</span>
      </TableCell>
      <TableCell>
        <form
          action={formAction}
          className="flex min-w-56 flex-col gap-2"
          onSubmit={(event) => {
            if (submitting.current) {
              event.preventDefault();
              return;
            }
            submitting.current = true;
          }}
        >
          <input type="hidden" name="key" value={setting.key} />
          <FormField
            id={`${prefix}-value`}
            label="Yeni değer"
            hint={hintFor(setting)}
            error={state.field === "value" || state.field === "key" ? state.message : null}
            required
          >
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="value"
                defaultValue={setting.effectiveValue}
                required
                maxLength={512}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>

          {state.status !== "IDLE" && state.field === null ? <Outcome state={state} /> : null}

          <button
            type="submit"
            className={PRIMARY}
            disabled={pending || state.status === "SUCCEEDED"}
          >
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </form>
      </TableCell>
    </TableRow>
  );
}

function hintFor(setting: PresentedSetting): string {
  if (setting.kind === "rate") return "0 ile 1 arasında bir oran.";
  if (setting.kind === "version") return "Örnek: 1.4.0";
  return "Sayısal değer.";
}

function Outcome({ state }: { readonly state: AuthorizationChangeOutcome }) {
  return (
    <div
      role="status"
      className={
        state.status === "SUCCEEDED"
          ? "rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
          : "rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink"
      }
    >
      <p>{state.message}</p>
      {state.errorCode === null ? null : (
        <p className="mt-1 text-xs text-ink-muted">
          Hata kodu: <span className="font-mono">{state.errorCode}</span>
        </p>
      )}
      {state.requestId === null ? null : (
        <p className="text-xs text-ink-muted">
          İstek numarası: <span className="font-mono break-all">{state.requestId}</span>
        </p>
      )}
    </div>
  );
}
