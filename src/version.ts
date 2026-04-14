import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// VERSION file lives at the package root (one level up from dist/)
export const VERSION: string = readFileSync(join(__dirname, '..', 'VERSION'), 'utf8').trim();