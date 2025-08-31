import https from 'https';
import fetch from 'node-fetch';

export const httpsAgent = new https.Agent({ family: 4 });

export async function fetchWithRetry(
  url: string, 
  options: any = {}, 
  maxRetries: number = 3
): Promise<import('node-fetch').Response> {
  let retryCount = 0;
  
  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(url, { ...options, agent: httpsAgent });
      
      if (response.ok) {
        return response;
      }

      if (response.status >= 500 && retryCount < maxRetries) {
        retryCount++;
        await sleep(5000);
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error) {
      if (retryCount >= maxRetries) {
        throw error;
      }
      retryCount++;
      await sleep(5000);
    }
  }
  
  throw new Error(`Failed after ${maxRetries} retries`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}