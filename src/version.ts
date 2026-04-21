import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// VERSION file lives at the package root (one level up from dist/)
export const VERSION: string = readFileSync(join(__dirname, '..', 'VERSION'), 'utf8').trim();
