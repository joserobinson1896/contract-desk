/**
 * Local app settings.
 *
 * Deliberately holds no credentials. The Gemini key lives in the server's
 * environment and is read only inside the `/api/parse` route; nothing about it is
 * configurable from the UI, stored on the device, or reachable from the client
 * bundle. A secret the client can hold is a secret anyone with devtools can read,
 * so the client is never given one to hold.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const OPERATOR_KEY = 'hologram.settings.operator';
const APPEARANCE_KEY = 'hologram.settings.appearance';

/**
 * Key left over from the build where the user pasted their own parse token. It is
 * purged on load so a token typed into an older version does not sit in device
 * storage indefinitely — nothing reads it any more, but a stale secret at rest is
 * still a stale secret.
 */
const LEGACY_TOKEN_KEY = 'hologram.settings.parseToken';

export async function purgeLegacyCredentials(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Best effort — a storage failure here must never block app start.
  }
}

/* -------------------------------------------------------------------------- */

/** `system` follows the device; the other two override it. */
export type Appearance = 'system' | 'light' | 'dark';

function isAppearance(value: string | null): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

export async function getAppearance(): Promise<Appearance> {
  try {
    const stored = await AsyncStorage.getItem(APPEARANCE_KEY);
    // Anything unrecognised falls back to the device rather than to a guess about
    // which of the two the user meant.
    return isAppearance(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export async function setAppearance(value: Appearance): Promise<void> {
  try {
    await AsyncStorage.setItem(APPEARANCE_KEY, value);
  } catch {
    // Best effort — a storage failure must not stop the theme from changing for
    // this session.
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Who is making decisions. Recorded against every resolved flag and policy change
 * so the audit log names a person rather than "someone".
 */
export async function getOperator(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(OPERATOR_KEY)) ?? 'unattributed';
  } catch {
    return 'unattributed';
  }
}

export async function setOperator(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    await AsyncStorage.removeItem(OPERATOR_KEY);
    return;
  }
  await AsyncStorage.setItem(OPERATOR_KEY, trimmed);
}
