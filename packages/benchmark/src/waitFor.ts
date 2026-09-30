export const waitFor = async <T>(read: () => Promise<T | undefined>, timeoutMs: number, intervalMs = 100): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for TypeScript worker readiness`)
}
