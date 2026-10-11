import { Worker } from 'node:worker_threads';
import { validateWorkbookZip } from './uploads';
let activeWorkers = 0;
export function parseExcelInWorker(base64Data: string, timeoutMs: number = 5000): Promise<string> {
  if (activeWorkers >= 2) return Promise.reject(new Error('Spreadsheet processing is busy. Try again shortly.'));
  activeWorkers++;
  return new Promise<string>((resolve, reject) => {
    const workerScript = `
      const { parentPort, workerData } = require('worker_threads');
      const XLSX = require('xlsx');

      try {
        const buffer = Buffer.from(workerData.base64, 'base64');
        if (buffer.length > 4 * 1024 * 1024) {
          throw new Error('Spreadsheet exceeds maximum allowed size');
        }

        const validateWorkbookZip = (${validateWorkbookZip.toString()});
        if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
          if (!validateWorkbookZip(buffer, require('node:zlib').inflateRawSync)) throw new Error('Invalid workbook archive');
        } else if (!buffer.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]))) {
          const plain = new TextDecoder('utf-8', { fatal: true }).decode(buffer).trimStart();
          if (['<', '{', '['].includes(plain[0]) || [...plain].some(c => c.charCodeAt(0) < 32 && ![9,10,13].includes(c.charCodeAt(0)))) throw new Error('Invalid spreadsheet format');
        }
        const workbook = XLSX.read(buffer, { type: 'buffer', dense: true });
        let combinedSheetText = '';

        const sheetNames = (workbook.SheetNames || []).slice(0, 5);
        for (const sheetName of sheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet || combinedSheetText.length >= 100000) continue;

          // Cap rows and columns before conversion to prevent ReDoS / memory exhaustion
          if (worksheet['!ref']) {
            const range = XLSX.utils.decode_range(worksheet['!ref']);
            if (range.e.r > 500) range.e.r = 500;
            if (range.e.c > 50) range.e.c = 50;
            worksheet['!ref'] = XLSX.utils.encode_range(range);
          }

          const csv = XLSX.utils.sheet_to_csv(worksheet);
          if (csv && csv.trim().length > 0) {
            combinedSheetText += '\\n\\n=== Sheet: ' + sheetName + ' ===\\n' + csv.slice(0, 50000);
          }
        }

        parentPort.postMessage({ success: true, text: combinedSheetText });
      } catch (err) {
        parentPort.postMessage({ success: false, error: 'Unable to parse spreadsheet. The file may be corrupt, password-protected, or in an unsupported format.' });
      }
    `;

    const worker = new Worker(workerScript, {
      eval: true,
      workerData: { base64: base64Data },
      resourceLimits: { maxOldGenerationSizeMb: 64 }
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate().catch(() => {});
        reject(new Error('Excel processing timed out.'));
      }
    }, timeoutMs);

    worker.on('message', (msg: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      if (msg.success) {
        resolve(msg.text);
      } else {
        reject(new Error(msg.error || 'Failed to parse Excel file'));
      }
    });

    worker.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      reject(err);
    });

    worker.on('exit', (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Excel worker stopped without a result (code ${code})`));
    });
  }).finally(() => { activeWorkers--; });
}
