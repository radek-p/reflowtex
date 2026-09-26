// SPDX-License-Identifier: AGPL-3.0-or-later
// Speech Rule Engine ships no types; mathml.ts uses these three calls.
declare module 'speech-rule-engine' {
  export function setupEngine(options: object): Promise<void>;
  export function engineReady(): Promise<void>;
  export function toSpeech(mathml: string): string;
}
