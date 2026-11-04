import { gateLocation, type GatedLocation } from "@/lib/location-gate";
import type { WorkSession } from "@/server/api/escrow";

/**
 * Mesai oturumunun bileşene giden hâli (koala-admin#135). Ham koordinat alanları
 * tipten de çıkarıldı: bileşen `checkInLatitude` okumaya kalkarsa derleme
 * kırılır, yani kapı yalnız bir `if` değil, verinin biçimidir.
 */
export type GatedWorkSession = Omit<
  WorkSession,
  | "checkInLatitude"
  | "checkInLongitude"
  | "checkOutLatitude"
  | "checkOutLongitude"
  | "checkInLocationWithheld"
  | "checkOutLocationWithheld"
> & {
  readonly checkInLocation: GatedLocation;
  readonly checkOutLocation: GatedLocation;
};

/**
 * Oturumlardaki giriş/çıkış konumunu `user.read_pii` kapısından geçirir.
 * `canReadLocation` çağıranın `/admin/me`'den bu istekte çözdüğü izindir;
 * `…LocationWithheld` backend'in (koala-backend#352) maskelediği `null`u
 * "konum yok"tan ayırır.
 */
export function gateWorkSessions(
  sessions: readonly WorkSession[],
  canReadLocation: boolean,
): readonly GatedWorkSession[] {
  return sessions.map(
    ({
      checkInLatitude,
      checkInLongitude,
      checkOutLatitude,
      checkOutLongitude,
      checkInLocationWithheld,
      checkOutLocationWithheld,
      ...session
    }): GatedWorkSession => ({
      ...session,
      checkInLocation: gateLocation(
        checkInLatitude,
        checkInLongitude,
        canReadLocation,
        checkInLocationWithheld,
      ),
      checkOutLocation: gateLocation(
        checkOutLatitude,
        checkOutLongitude,
        canReadLocation,
        checkOutLocationWithheld,
      ),
    }),
  );
}
