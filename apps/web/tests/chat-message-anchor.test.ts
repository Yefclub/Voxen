import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chatSource = readFileSync(join(import.meta.dir, '../src/client/pages/chat.tsx'), 'utf8');

describe('chat message anchor wiring (spec 092)', () => {
  test('imports pure scroll helpers and retries mount frames', () => {
    expect(chatSource).toContain("from '../lib/chat-scroll'");
    expect(chatSource).toContain('ANCHOR_MOUNT_RETRY_FRAMES');
    expect(chatSource).toContain('anchorUserMessage');
    expect(chatSource).toContain('planAnchor');
  });

  test('marks user bubbles with data-message-id and keeps a spacer node', () => {
    expect(chatSource).toContain('data-message-id={message.id}');
    expect(chatSource).toContain('ref={spacerNodeRef}');
    expect(chatSource).toContain('pendingAnchorIdRef.current = localUser.id');
  });

  test('disables stick-to-bottom while scroll phase is anchor', () => {
    expect(chatSource).toContain("scrollPhaseRef.current === 'anchor'");
    expect(chatSource).toContain('handleContentGrowth');
  });

  test('ResizeObserver re-attaches after the conversation scroller mounts', () => {
    expect(chatSource).toContain('if (loading || isEmpty) return;');
    expect(chatSource).toContain('}, [loading, isEmpty]);');
    expect(chatSource).toContain('new ResizeObserver(() => handleContentGrowth())');
  });

  test('gates reengage: spacer + allow only after final text (or turn end)', () => {
    expect(chatSource).toContain('allowAnchorReengageRef');
    expect(chatSource).toContain('allowAnchorReengageRef.current = false');
    expect(chatSource).toContain('allowAnchorReengageRef.current = true');
    expect(chatSource).toContain('spacerHeight: spacerHeightRef.current');
    expect(chatSource).toContain('allowReengage: allowAnchorReengageRef.current');
  });
});
