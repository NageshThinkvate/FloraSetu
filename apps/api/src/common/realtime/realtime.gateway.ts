// Real-time abstraction — interface only in Build 0 (WebSocket/SSE impl deferred).
export interface RealtimeGateway {
  emitToOrg(orgId: string, channel: string, payload: Record<string, unknown>): Promise<void>;
  emitToUser(userId: string, channel: string, payload: Record<string, unknown>): Promise<void>;
}

export const REALTIME_GATEWAY = 'REALTIME_GATEWAY';

export class NoopRealtimeGateway implements RealtimeGateway {
  async emitToOrg(): Promise<void> {}
  async emitToUser(): Promise<void> {}
}
