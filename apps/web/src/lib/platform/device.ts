// Platform capability abstraction (ADR-006): web now, Capacitor-native later.
// Build 0 ships interfaces + web stubs only; no native code.

export interface CameraPort {
  capturePhoto(context: 'QC_INSPECTION' | 'CLAIM_EVIDENCE'): Promise<Blob>;
}

export interface PushPort {
  isSupported(): boolean;
  subscribe(): Promise<PushSubscription | null>;
}

export const webPushPort: PushPort = {
  isSupported: () => 'serviceWorker' in navigator && 'PushManager' in window,
  async subscribe(): Promise<PushSubscription | null> {
    if (!this.isSupported()) {
      return null;
    }
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }
};
