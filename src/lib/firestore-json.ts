type TimestampLike = {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

function isTimestampLike(value: unknown): value is TimestampLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as TimestampLike;
  return (
    typeof candidate.toMillis === 'function' ||
    typeof candidate.seconds === 'number' ||
    typeof candidate._seconds === 'number'
  );
}

export function toFirestoreJson<T>(value: T): T {
  if (value == null) return value;

  if (isTimestampLike(value)) {
    if (typeof value.toMillis === 'function') return value.toMillis() as T;
    const seconds = value.seconds ?? value._seconds ?? 0;
    const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
    return Math.round(seconds * 1000 + nanos / 1_000_000) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toFirestoreJson(item)) as T;
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toFirestoreJson(entry),
      ])
    ) as T;
  }

  return value;
}
