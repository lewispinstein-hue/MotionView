import type { TelemetryClient } from "./telemetryClient";

const FEEDBACK_RATE_LIMIT_MS = 5 * 60 * 1000;
const LAST_SUBMISSION_STORAGE_KEY = "motionview.feedback.last-submitted-at";

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export type FeedbackProduct = "motionview" | "mvlib";
export type FeedbackType = "bug_report" | "feature_request" | "general_feedback";
export type FeedbackArea = "viewing" | "planning" | "other";

export interface FeedbackSubmission {
  readonly description: string;
  readonly product: FeedbackProduct;
  readonly feedbackType: FeedbackType;
  readonly area: FeedbackArea | null;
  readonly routeJson: string | null;
  readonly appMode: "viewing" | "planning";
  readonly submittedAt: string;
}

export type FeedbackDelivery = "sent" | "queued" | "rate_limited";

export class FeedbackTelemetry {
  private lastSubmissionAt = 0;

  constructor(private readonly telemetry: TelemetryClient) {}

  async submit(submission: FeedbackSubmission): Promise<FeedbackDelivery> {
    if (this.remainingRateLimitMs() > 0) return "rate_limited";
    // Feedback owns its persisted cooldown. A second telemetry-client debounce
    // can retain an old value when this setting changes during development.
    const sent = await this.telemetry.capture("feedback_submitted", this.propertiesFor(submission));
    this.recordSubmission();
    return sent ? "sent" : "queued";
  }

  remainingRateLimitMs(now = Date.now()): number {
    try {
      const storedAt = Number(localStorage.getItem(LAST_SUBMISSION_STORAGE_KEY));
      const submittedAt = Math.max(this.lastSubmissionAt, Number.isFinite(storedAt) ? storedAt : 0);
      return Math.max(0, submittedAt + FEEDBACK_RATE_LIMIT_MS - now);
    } catch {
      return Math.max(0, this.lastSubmissionAt + FEEDBACK_RATE_LIMIT_MS - now);
    }
  }

  rateLimitMessage(): string {
    if (FEEDBACK_RATE_LIMIT_MS <= 0) return "Feedback can be sent again now.";
    return `Feedback is limited to one submission every ${formatDuration(FEEDBACK_RATE_LIMIT_MS)}. Try again in about ${formatDuration(this.remainingRateLimitMs())}.`;
  }

  private recordSubmission(): void {
    this.lastSubmissionAt = Date.now();
    try {
      localStorage.setItem(LAST_SUBMISSION_STORAGE_KEY, String(this.lastSubmissionAt));
    } catch {
      // The in-memory debounce still protects this running app.
    }
  }

  private propertiesFor(submission: FeedbackSubmission): Record<string, unknown> {
    return {
      description: submission.description,
      product: submission.product,
      feedback_type: submission.feedbackType,
      area: submission.area,
      route_json: submission.routeJson,
      app_mode: submission.appMode,
      submitted_at: submission.submittedAt,
    };
  }
}
