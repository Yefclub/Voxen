import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './markdown';

test('nested source headings do not create a second page title or change source text', () => {
  const source = '# Source title\n\n## Evidence';
  const nested = renderToStaticMarkup(<Markdown headingOffset={2}>{source}</Markdown>);
  expect(nested).toContain('<h3>Source title</h3>');
  expect(nested).toContain('<h4>Evidence</h4>');
  expect(nested).not.toContain('<h1>');
  const standalone = renderToStaticMarkup(<Markdown>{source}</Markdown>);
  expect(standalone).toContain('<h1>Source title</h1>');
  expect(standalone).toContain('<h2>Evidence</h2>');
});
