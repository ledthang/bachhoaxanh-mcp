// Single source of truth for the persistent Chromium profile directory.
// Precedence: BHX_PROFILE_DIR > join(BHX_RUNTIME_DIR, 'profile') > ~/.local/share/bhx-mcp/profile.
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const set = value => typeof value === 'string' && value.trim() !== '';

export function profileDirectory() {
  const home = homedir();
  // Relative values resolve against homedir(); absolute values pass through unchanged.
  const directory = set(process.env.BHX_PROFILE_DIR)
    ? resolve(home, process.env.BHX_PROFILE_DIR)
    : set(process.env.BHX_RUNTIME_DIR)
      ? join(resolve(home, process.env.BHX_RUNTIME_DIR), 'profile')
      : join(home, '.local/share/bhx-mcp/profile');
  let status;
  try { status = statSync(directory); }
  catch (error) {
    // ENOTDIR: some parent is a file — this path can never become a profile dir.
    if (error && error.code === 'ENOTDIR') throw new Error(`BHX_PROFILE_NOT_A_DIRECTORY: ${directory}`);
    return directory;
  }
  if (!status.isDirectory()) throw new Error(`BHX_PROFILE_NOT_A_DIRECTORY: ${directory}`);
  return directory;
}
