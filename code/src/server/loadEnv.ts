import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** BlurGuard package root, so the app still finds .env and data when this folder sits inside another repo. */
export const PROJECT_ROOT = path.resolve(here, '../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env inside the BlurGuard folder and set it before starting.`,
    );
  }
  return value;
}
