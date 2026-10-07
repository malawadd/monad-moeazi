const RETRIES = 2;

function missingRevertData(error: any) {
  const details = [error?.shortMessage, error?.message, error?.info?.error?.message,
    error?.error?.message, error?.cause?.shortMessage, error?.cause?.message].filter(Boolean).join(" ");
  return /missing revert data/i.test(details);
}

export async function retryMissingRevertData<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await read(); }
    catch (error) {
      if (!missingRevertData(error) || attempt >= RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
