import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const serviceRoot = join(sourceRoot, 'services');
const queryRoot = join(sourceRoot, 'queries');

const filesUnder = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(filePath);
    return entry.isFile() && filePath.endsWith('.ts') ? [filePath] : [];
  });

const importsOf = (filePath: string): Array<{ specifier: string; line: number }> => {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    return [{
      specifier: statement.moduleSpecifier.text,
      line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
    }];
  });
};

const resolveRelativeImport = (filePath: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  return normalize(join(dirname(filePath), specifier));
};

describe('service dependency boundaries', () => {
  it('keeps adapters and job consumers out of services', () => {
    const forbidden = /(?:^|\/)(controllers|routes|tools|plugins|agents|jobs)(?:\/|$)/;
    const violations = filesUnder(serviceRoot).flatMap((filePath) => importsOf(filePath)
      .filter(({ specifier }) => forbidden.test(resolveRelativeImport(filePath, specifier) ?? specifier))
      .map(({ specifier, line }) => `${relative(process.cwd(), filePath)}:${line} -> ${specifier}`));

    expect(violations).toEqual([]);
  });

  it('keeps database queries independent from services', () => {
    const violations = filesUnder(queryRoot).flatMap((filePath) => importsOf(filePath)
      .filter(({ specifier }) => /(?:^|\/)services(?:\/|$)/.test(resolveRelativeImport(filePath, specifier) ?? specifier))
      .map(({ specifier, line }) => `${relative(process.cwd(), filePath)}:${line} -> ${specifier}`));

    expect(violations).toEqual([]);
  });

  it('keeps swap settlement storage and value helpers private to swaps', () => {
    const privateNames = ['settlement-store', 'settlement-values'];
    const violations = filesUnder(serviceRoot).flatMap((filePath) => importsOf(filePath)
      .filter(({ specifier }) => {
        const resolved = resolveRelativeImport(filePath, specifier);
        const isPrivateImport = resolved !== null
          && privateNames.some((name) => resolved.endsWith(`/${name}`));
        return isPrivateImport && !filePath.includes('/services/financial/swaps/');
      })
      .map(({ specifier, line }) => `${relative(process.cwd(), filePath)}:${line} -> ${specifier}`));

    expect(violations).toEqual([]);
  });
});
