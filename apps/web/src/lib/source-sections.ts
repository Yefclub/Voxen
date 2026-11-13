// Complete bounded text windows shared by capture and external research.
import { CaptureError } from './capture/errors';

const SINGLE_TEXT_LIMIT = 60_000;
export const SECTION_LIMIT = 48_000;
const MAX_SECTIONS = 24;

export function sourceSections(text: string): string[] {
  if (text.length <= SINGLE_TEXT_LIMIT) return [text];
  if (text.length > SECTION_LIMIT * MAX_SECTIONS) throw new CaptureError('TEXT_TOO_LARGE');
  const sections: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + SECTION_LIMIT, text.length);
    // Prefer paragraph boundaries without leaving gaps between source windows.
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      const remainingSlots = MAX_SECTIONS - sections.length - 1;
      const minimumEnd = Math.max(
        start + SECTION_LIMIT / 2,
        text.length - remainingSlots * (SECTION_LIMIT - 1),
      );
      if (newline >= minimumEnd) end = newline + 1;
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    sections.push(text.slice(start, end));
    if (sections.length > MAX_SECTIONS) throw new CaptureError('TEXT_TOO_LARGE');
    start = end;
  }
  return sections;
}
