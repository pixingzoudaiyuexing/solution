export async function cancelUnusedResponseBody(
  response: Response
): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup failure must not replace the original response classification.
  }
}
