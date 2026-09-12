// Device capability abstraction (ADR-006) — interfaces only; native impls behind Capacitor later.
export interface CameraCapture {
  capturePhoto(context: 'QC_INSPECTION' | 'CLAIM_EVIDENCE'): Promise<{ objectKey: string }>;
}

export interface PushRegistration {
  registerWebPush(subscription: Record<string, unknown>): Promise<void>;
  registerNativeToken(platform: 'FCM' | 'APNS', token: string): Promise<void>;
}

export const CAMERA_CAPTURE = 'CAMERA_CAPTURE';
export const PUSH_REGISTRATION = 'PUSH_REGISTRATION';
