type ParserPurifier = {
  addHook: (...arguments_: unknown[]) => void;
  sanitize: (value: string) => string;
};

export {};

try {
  const source = await Bun.stdin.text();
  // Parsing runs in a short-lived process after the source security gate. Mermaid's
  // Node import exposes the DOMPurify factory without browser hooks, so provide the
  // two inert methods used while parsing. No SVG is rendered or returned here.
  const purifier = (await import('dompurify')).default as unknown as ParserPurifier;
  purifier.addHook = () => undefined;
  purifier.sanitize = (value) => value;
  const mermaid = (await import('mermaid')).default;
  const parsed = await mermaid.parse(source, { suppressErrors: true });
  process.stdout.write(parsed === false ? 'invalid' : 'valid');
} catch {
  process.stdout.write('invalid');
}
