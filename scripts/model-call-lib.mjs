export function parseStructuredModelOutput(value) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    throw new Error(`malformed structured model output: ${error.message}`);
  }
}

export async function withModelRetries(operation, { attempts = 3, delayMs = 0, onRetry = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      onRetry(error, attempt);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function mapWithConcurrency(values, concurrency, operation) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
