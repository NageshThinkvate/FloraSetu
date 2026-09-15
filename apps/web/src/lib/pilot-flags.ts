import { apiGet } from './api/client';

export interface PilotFlags {
  independentInspectionEnabled: boolean;
  lotEvidenceMinPhotos: number;
}

let cached: PilotFlags | null = null;
let inflight: Promise<PilotFlags> | null = null;

// ADR-011 pilot runtime flags (server is authoritative; safe defaults while loading).
export function getPilotFlags(): Promise<PilotFlags> {
  if (cached) {
    return Promise.resolve(cached);
  }
  if (!inflight) {
    inflight = apiGet<PilotFlags>('/config/pilot')
      .then((f) => {
        cached = f;
        return f;
      })
      .catch(() => ({ independentInspectionEnabled: false, lotEvidenceMinPhotos: 2 }));
  }
  return inflight;
}

export function resetPilotFlagsCache(): void {
  cached = null;
  inflight = null;
}
