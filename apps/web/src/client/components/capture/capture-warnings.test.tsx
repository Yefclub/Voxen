import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../lib/i18n';
import { CaptureWarnings } from './capture-warnings';

test('announces supported partial-result diagnostics once and ignores unknown data', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <CaptureWarnings
        announce
        codes={[
          'speech_not_transcribed',
          'frames_unavailable',
          'images_not_described',
          'images_not_described',
          '__proto__',
          '<script>untrusted</script>',
          null,
        ]}
      />
    </I18nProvider>,
  );
  expect(html.match(/<li>/g)).toHaveLength(3);
  expect(html).toContain('role="status"');
  expect(html).not.toContain('untrusted');
  expect(html).not.toContain('__proto__');
});

test('does not render an empty diagnostic panel', () => {
  expect(
    renderToStaticMarkup(
      <I18nProvider>
        <CaptureWarnings codes={['unknown', null]} />
      </I18nProvider>,
    ),
  ).toBe('');
});
