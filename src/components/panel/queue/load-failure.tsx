import { ErrorState } from "@/components/ui";
import { isPermission, permissionLabel } from "@/server/authz/permissions";

/**
 * What a queue shows when the backend would not give it the queue.
 *
 * The `forbidden` case is the one that earns a shared component. The panel's
 * gate is a courtesy: it saves a request the backend was going to refuse and
 * explains the refusal in Turkish. `@RequiresPermission` is the authority, and
 * when the two disagree — the gate opened, the backend said no — the honest
 * screen shows the backend's verdict rather than crashing or, worse, rendering
 * an empty table that reads as "no reports were filed".
 *
 * Since koala-backend#14 an unmapped `/admin/...` path also answers 403 rather
 * than 404, so this state doubles as "this endpoint is not deployed yet".
 */

export type QueueFailure =
  | {
      readonly kind: "forbidden";
      readonly errorCode: string | null;
      readonly requestId: string | null;
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly errorCode: string | null;
      readonly requestId: string | null;
    };

export interface QueueLoadFailureProps {
  /** What could not be loaded, e.g. `"Şikayet kuyruğu"`. */
  subject: string;
  /** The permission the backend refused, named so the operator can ask for it. */
  permission: string;
  failure: QueueFailure;
}

function namedPermission(permission: string): string {
  return isPermission(permission) ? permissionLabel(permission) : permission;
}

export function QueueLoadFailure({ subject, permission, failure }: QueueLoadFailureProps) {
  if (failure.kind === "forbidden") {
    return (
      <ErrorState
        title="Backend bu işlem için yetki vermedi."
        description={`Panel sayfayı açtı, backend ${subject.toLocaleLowerCase("tr")} vermeyi reddetti. Bu ekran "${namedPermission(permission)}" iznini ister; yetki kararını backend verir.`}
        errorCode={failure.errorCode}
        requestId={failure.requestId}
      />
    );
  }

  return (
    <ErrorState
      title={`${subject} yüklenemedi.`}
      description={failure.message}
      errorCode={failure.errorCode}
      requestId={failure.requestId}
    />
  );
}
