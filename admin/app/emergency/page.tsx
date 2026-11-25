'use client';
import EmergencyCode from '@/components/EmergencyCode';

export default function Emergency() {
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Emergency code</h1>
        <p className="text-sm text-slate-500">When a school is locked (not paid yet, no internet, waiting for approval…) you can let it work for 5 more days. After that it locks again until the subscription is paid and active; then the next lock allows a new code.</p>
      </div>
      <EmergencyCode />
    </div>
  );
}
