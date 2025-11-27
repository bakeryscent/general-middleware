import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const toMessage = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const recordSpanException = (error: unknown, attributes?: Attributes) => {
  const span = trace.getActiveSpan();

  if (!span) {
    return;
  }

  if (error instanceof Error) {
    span.recordException(error);
  } else {
    span.recordException({ message: toMessage(error) });
  }

  if (attributes) {
    span.setAttributes(attributes);
  }

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: toMessage(error),
  });
};
