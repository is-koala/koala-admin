import { gateLocation, type GatedLocation } from "@/lib/location-gate";
import type { WorkSession } from "@/server/api/escrow";

/**
 * Mesai oturumunun bileşene giden hâli (koala-admin#135). Ham koordinat alanları
 * tipten de çıkarıldı: bileşen `checkInLatitude` okumaya kalkarsa derleme
 * kırılır, yani kapı yalnız bir `if` değil, verinin biçimidir.
 */
export type GatedWorkSession = Omit<
  WorkSession,
  "checkInLatitude" | "checkInLongitude" | "checkOutLatitude" | "checkOutLongitude"
> & {
  readonly checkInLocation: GatedLocation;
  readonly checkOutLocation: GatedLocation;
};

/**
 * Oturumlardaki giriş/çıkış konumunu `user.read_pii` kapısından geçirir.
 * `canReadLocation` çağıranın `/admin/me`'den bu istekte çözdüğü izindir.
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
      ...session
    }): GatedWorkSession => ({
      ...session,
      checkInLocation: gateLocation(checkInLatitude, checkInLongitude, canReadLocation),
      checkOutLocation: gateLocation(checkOutLatitude, checkOutLongitude, canReadLocation),
    }),
  );
}
