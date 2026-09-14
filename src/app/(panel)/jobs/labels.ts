import type { BadgeTone } from "@/components/ui";
import type { JobStatus } from "@/server/api/jobs";

/** İlan durumunun rozet tonu — liste ve nesne sayfası aynı rengi kullansın. */
export const JOB_STATUS_TONES: Record<JobStatus, BadgeTone> = {
  OPEN: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
};
