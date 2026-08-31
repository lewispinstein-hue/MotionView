import type { TelemetryClient } from "./telemetryClient";

const FEEDBACK_RATE_LIMIT_MS = 15 * 60 * 1000;
const LAST_SUBMISSION_STORAGE_KEY = "motionview.feedback.last-submitted-at";

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
    const sent = await this.telemetry.capture("feedback_submitted", this.propertiesFor(submission), {
      debounceMs: FEEDBACK_RATE_LIMIT_MS,
      debounceKey: "feedback_submitted",
    });
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
    const minutes = Math.max(1, Math.ceil(this.remainingRateLimitMs() / 60_000));
    return `Feedback is limited to one submission every 15 minutes. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
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
